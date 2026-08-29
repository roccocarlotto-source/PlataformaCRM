import { prisma, type Db } from "../lib/prisma";
import { countActiveBookingsByServiceType } from "../repositories/booking.repository";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import { findResourceById, lockResourceForUpdate } from "../repositories/resource.repository";
import {
  countServiceTypes,
  createServiceType as createServiceTypeRepo,
  findManyServiceTypes,
  findServiceTypeById,
  lockServiceTypeForUpdate,
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
// RESTRICT contra Booking — AHORA CUENTA RESERVAS REALES
// ---------------------------------------------------------------------------
//
// Hasta el paso 3 esto devolvía `0` fijo, porque el modelo Booking no existía.
// Los TRES pendientes que aquella versión dejó anotados están cerrados en este
// mismo PR:
//
//   1. el count real (acá abajo);
//   2. el lock de fila del ServiceType en deleteServiceType (más abajo);
//   3. el @@unique([organizationId, id]) del schema, que ahora sí lo referencia
//      la FK compuesta de Booking.
//
// SOLO CONFIRMED CUENTA COMO ACTIVA, y ésa era la decisión que quedó
// explícitamente pendiente. COMPLETED y NO_SHOW son HISTORIA: describen turnos
// que ya pasaron, así que borrar el servicio no las pierde ni las contradice —
// las filas siguen ahí con su FK intacta, porque el borrado es lógico.
// CANCELLED tampoco bloquea, por lo mismo. Bloquear por historia haría que un
// servicio con un año de uso fuera imposible de dar de baja, que es justo lo
// contrario de lo que un RESTRICT tiene que proteger.
// ---------------------------------------------------------------------------
export async function deleteServiceType(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que deleteBranch y
  // deletePipeline. No es la defensa: se revalida adentro, con el lock sostenido.
  await getServiceTypeById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    // EL LOCK QUE FALTABA. Sin él, el RESTRICT de acá abajo decide sobre un
    // conteo que se queda viejo entre que se lee y que se borra: alguien podría
    // crear una reserva justo en el medio y quedaría colgando de un servicio ya
    // eliminado. Es la lección de ALTO-8 —el chequeo solo no cierra nada— y es
    // el mismo lock que createBooking toma del otro lado.
    await lockServiceTypeForUpdate(id, organizationId, tx);

    const serviceType = await findServiceTypeById(id, organizationId, tx);
    if (!serviceType) {
      throw new AppError("Servicio no encontrado", 404);
    }

    const reservasActivas = await countActiveBookingsByServiceType(id, organizationId, tx);
    if (reservasActivas > 0) {
      throw new AppError(
        "No se puede eliminar un servicio que tiene reservas activas. Cancelalas primero.",
        400,
      );
    }

    const result = await softDeleteServiceType(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Servicio no encontrado", 404);
    }
  });
}
