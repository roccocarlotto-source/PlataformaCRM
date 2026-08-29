import { prisma, type Db } from "../lib/prisma";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import { findResourceById, lockResourceForUpdate } from "../repositories/resource.repository";
import {
  countServiceTypes,
  createServiceType as createServiceTypeRepo,
  findManyServiceTypes,
  findServiceTypeById,
  softDeleteServiceType,
  updateServiceType as updateServiceTypeRepo,
  type ServiceTypeFilters,
  type ServiceTypeSortBy,
  type SortOrder,
} from "../repositories/serviceType.repository";
import { AppError } from "../utils/AppError";

export interface ListServiceTypesParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  resourceId?: string;
  sortBy: ServiceTypeSortBy;
  sortOrder: SortOrder;
}

export async function listServiceTypes(organizationId: string, params: ListServiceTypesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyServiceTypes(
      organizationId,
      filters as ServiceTypeFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countServiceTypes(organizationId, filters as ServiceTypeFilters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getServiceTypeById(organizationId: string, id: string) {
  const serviceType = await findServiceTypeById(id, organizationId);
  if (!serviceType) {
    throw new AppError("Servicio no encontrado", 404);
  }
  return serviceType;
}

async function validateBranchId(organizationId: string, branchId: string, db: Db = prisma) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

// EL RECURSO TIENE QUE EXISTIR EN LA ORGANIZACIÓN **Y** PERTENECER A LA SUCURSAL
// INDICADA. La segunda mitad es la que el documento de diseño no menciona y hace
// falta igual: un ServiceType "de la sucursal A" que en realidad usa un recurso
// de la B es un dato inconsistente que nadie ve hasta que alguien intenta
// reservar, y ahí el error aparece a tres capas de distancia de su causa.
//
// La FK compuesta a resources NO alcanza para esto: garantiza que el recurso sea
// de la misma ORGANIZACIÓN, que es lo que C-3 impone, pero no hay forma de
// expresar "y además de la misma sucursal" en una FK sin denormalizar más
// columnas. Por eso vive acá y tiene test propio.
//
// Es exactamente el patrón que Opportunity ya usa para Stage/Pipeline
// (validateStageId en opportunity.service.ts): mismo chequeo de pertenencia, en
// el mismo lugar, con el mismo tipo de error.
async function validateResourceId(
  organizationId: string,
  resourceId: string,
  branchId: string,
  db: Db = prisma,
) {
  const resource = await findResourceById(resourceId, organizationId, db);
  if (!resource) {
    throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 400);
  }
  if (resource.branchId !== branchId) {
    throw new AppError("El recurso indicado no pertenece a la sucursal especificada", 400);
  }
  return resource;
}

export interface CreateServiceTypeInput {
  branchId: string;
  resourceId: string;
  name: string;
  durationMin: number;
  capacity?: number;
}

export async function createServiceType(organizationId: string, input: CreateServiceTypeInput) {
  // Pre-checks rápidos, fuera de la transacción: 400 inmediato en el caso común
  // sin abrir una. No son la defensa — las lecturas que deciden son las de
  // adentro, con los locks ya tomados.
  await validateBranchId(organizationId, input.branchId);
  await validateResourceId(organizationId, input.resourceId, input.branchId);

  return prisma.$transaction(async (tx) => {
    // ORDEN FIJO: branch y DESPUÉS resource. Es el único camino del módulo que
    // toma los dos locks, y ningún otro toma resource antes que branch, así que
    // no hay forma de que dos transacciones los tomen invertidos.
    //
    // Los dos hacen falta: sin el de branch, deleteBranch puede borrar la
    // sucursal entre el chequeo y la escritura; sin el de resource, lo mismo con
    // deleteResource. Son dos RESTRICT distintos y cada uno tiene su lado.
    await lockBranchForUpdate(input.branchId, organizationId, tx);
    await lockResourceForUpdate(input.resourceId, organizationId, tx);

    // Revalidan con los locks sostenidos. Sin esto los dos RESTRICT serían
    // evitables con solo llegar primero.
    await validateBranchId(organizationId, input.branchId, tx);
    await validateResourceId(organizationId, input.resourceId, input.branchId, tx);

    return createServiceTypeRepo(
      {
        organizationId,
        branchId: input.branchId,
        resourceId: input.resourceId,
        name: input.name,
        durationMin: input.durationMin,
        capacity: input.capacity,
      },
      tx,
    );
  });
}

export interface UpdateServiceTypeInput {
  branchId?: string;
  resourceId?: string;
  name?: string;
  durationMin?: number;
  capacity?: number;
}

export async function updateServiceType(
  organizationId: string,
  id: string,
  input: UpdateServiceTypeInput,
) {
  const serviceType = await getServiceTypeById(organizationId, id);

  // Mover de sucursal exige mover también el recurso, porque el recurso viejo
  // pertenece a la sucursal vieja: cambiar solo branchId dejaría exactamente la
  // inconsistencia que validateResourceId existe para impedir.
  //
  // Es la misma regla, con la misma forma, que updateOpportunity ya aplica a
  // pipelineId/stageId: "si cambiás el pipeline, indicá también el nuevo
  // stageId en la misma operación".
  if (input.branchId && !input.resourceId) {
    throw new AppError(
      "Si cambiás la sucursal, indicá también el nuevo resourceId en la misma operación",
      400,
    );
  }

  const branchIdEfectivo = input.branchId ?? serviceType.branchId;

  if (input.branchId) {
    await validateBranchId(organizationId, input.branchId);
  }

  const nuevoResourceId = input.resourceId;

  // La escritura va en transacción SOLO cuando cambia el recurso o la sucursal:
  // es el único caso con un invariante que defender —los RESTRICT de
  // deleteResource y deleteBranch— y por lo tanto el único que necesita locks.
  // Un UPDATE de nombre o duración no compite con nadie. Mismo criterio que
  // updateOpportunity.
  const result = nuevoResourceId
    ? await prisma.$transaction(async (tx) => {
        await lockBranchForUpdate(branchIdEfectivo, organizationId, tx);
        await lockResourceForUpdate(nuevoResourceId, organizationId, tx);

        await validateBranchId(organizationId, branchIdEfectivo, tx);
        await validateResourceId(organizationId, nuevoResourceId, branchIdEfectivo, tx);

        return updateServiceTypeRepo(id, organizationId, input, tx);
      })
    : await updateServiceTypeRepo(id, organizationId, input);

  if (result.count === 0) {
    throw new AppError("Servicio no encontrado", 404);
  }

  return getServiceTypeById(organizationId, id);
}

// ---------------------------------------------------------------------------
// RESTRICT contra Booking — ESCRITO ANTES DE QUE Booking EXISTA
// ---------------------------------------------------------------------------
//
// Hoy devuelve 0 SIEMPRE, porque el modelo Booking todavía no está en el schema
// (es el ítem siguiente de P2.1). Está escrito igual, y la única razón por la
// que eso no es código muerto disfrazado es que deja la forma correcta puesta:
// cuando Booking exista, esto es UNA LÍNEA —el count real— y no un rediseño del
// borrado.
//
// ⚠️ LO QUE HAY QUE HACER AL IMPLEMENTAR Booking, y está anotado también en
// docs/roadmap-implementacion.md §2.1 para que no dependa de que alguien lea
// este comentario:
//
//   1. reemplazar el 0 por el count real de Booking activos del serviceTypeId
//      (status CONFIRMED, y decidir explícitamente si COMPLETED/NO_SHOW cuentan
//      — probablemente no: son historia, no reservas vivas);
//   2. agregarle a deleteServiceType el lock de fila del ServiceType, que hoy no
//      tiene porque no hay nada contra qué serializar, exactamente igual que
//      lockResourceForUpdate en deleteResource;
//   3. agregar el @@unique([organizationId, id]) a ServiceType, que se dejó
//      afuera a propósito porque todavía nada lo referencia.
//
// Sin (1) y (2) juntos el bloqueo sería evitable por concurrencia, que es la
// lección de ALTO-8: el chequeo solo no cierra nada.
// Los parámetros se declaran sin usar A PROPÓSITO: son la firma que el count
// real va a necesitar, y dejarla puesta es lo que hace que implementarlo sea una
// línea. Mismo recurso que errorHandler.ts usa para el `_next` de Express.
function contarReservasActivas(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _serviceTypeId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _organizationId: string,
): number {
  return 0;
}

export async function deleteServiceType(organizationId: string, id: string) {
  await getServiceTypeById(organizationId, id);

  const reservasActivas = contarReservasActivas(id, organizationId);
  if (reservasActivas > 0) {
    throw new AppError(
      "No se puede eliminar un servicio que tiene reservas activas. Cancelalas primero.",
      400,
    );
  }

  const result = await softDeleteServiceType(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Servicio no encontrado", 404);
  }
}
