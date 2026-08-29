import { prisma } from "../lib/prisma";
import {
  countBranches,
  createBranch as createBranchRepo,
  findBranchById,
  findManyBranches,
  lockBranchForUpdate,
  softDeleteBranch,
  updateBranch as updateBranchRepo,
  type BranchSortBy,
  type SortOrder,
} from "../repositories/branch.repository";
import { countActiveResourcesByBranch } from "../repositories/resource.repository";
import { countActiveServiceTypesByBranch } from "../repositories/serviceType.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Branch (sucursal) — P2.1.
//
// SIN INVARIANTE DE "AL MENOS UNA SUCURSAL ACTIVA", a diferencia de Pipeline.
// Una organización que no usa Booking tiene cero Branch y ese es un estado
// válido: nada del CRM depende de que exista una. Por eso deleteBranch no
// necesita el lock de organización que H-1 le impuso a deletePipeline — el
// único invariante acá es sobre los hijos de ESTA sucursal, y se protege con el
// lock de su propia fila.
// ---------------------------------------------------------------------------

export interface ListBranchesParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: BranchSortBy;
  sortOrder: SortOrder;
}

export async function listBranches(organizationId: string, params: ListBranchesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyBranches(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countBranches(organizationId, filters),
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

export async function getBranchById(organizationId: string, id: string) {
  const branch = await findBranchById(id, organizationId);
  if (!branch) {
    throw new AppError("Sucursal no encontrada", 404);
  }
  return branch;
}

export interface CreateBranchInput {
  name: string;
  timezone: string;
}

export function createBranch(organizationId: string, input: CreateBranchInput) {
  // Sin unicidad de nombre: dos sucursales pueden llamarse igual ("Centro" en
  // dos ciudades). No hay ninguna constraint que traducir a 409, así que no hay
  // rethrowAsConflict que escribir — a diferencia de Pipeline, que sí tiene un
  // único (organizationId, name).
  return createBranchRepo({ organizationId, name: input.name, timezone: input.timezone });
}

export interface UpdateBranchInput {
  name?: string;
  timezone?: string;
}

export async function updateBranch(organizationId: string, id: string, input: UpdateBranchInput) {
  await getBranchById(organizationId, id);

  const result = await updateBranchRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError("Sucursal no encontrada", 404);
  }

  return getBranchById(organizationId, id);
}

// RESTRICT lógico, el criterio ya establecido en ALTO-8: no se borra una
// sucursal que tiene recursos o servicios activos colgando. Mismo formato de
// error que "el último pipeline" y que los dos RESTRICT de ALTO-8: AppError con
// 400.
//
// Y CON EL LOCK, que es la mitad que el chequeo solo no cubre. Un RESTRICT es
// una decisión sobre un conteo: sin serializar contra createResource /
// createServiceType, esos conteos se quedan viejos entre que se leen y que se
// escribe, y el bloqueo sería evitable con solo llegar primero. Es la misma
// clase de bug que H-1.
export async function deleteBranch(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que deletePipeline. No
  // es la defensa: se revalida adentro, con el lock sostenido.
  await getBranchById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockBranchForUpdate(id, organizationId, tx);

    const branch = await findBranchById(id, organizationId, tx);
    if (!branch) {
      throw new AppError("Sucursal no encontrada", 404);
    }

    // Los recursos primero: un ServiceType siempre cuelga de un Resource de la
    // misma sucursal, así que una sucursal con servicios activos tiene también
    // recursos activos. Preguntar por los recursos primero da el mensaje más
    // accionable — es el nivel por el que hay que empezar a limpiar.
    const recursosActivos = await countActiveResourcesByBranch(id, organizationId, tx);
    if (recursosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
        400,
      );
    }

    // Redundante mientras el invariante de arriba se sostenga —sin recursos no
    // puede haber servicios— y está igual: es la clase de redundancia que
    // sobrevive a que alguien afloje la relación entre ServiceType y Resource.
    const serviciosActivos = await countActiveServiceTypesByBranch(id, organizationId, tx);
    if (serviciosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene servicios activos. Eliminá primero sus servicios.",
        400,
      );
    }

    const result = await softDeleteBranch(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Sucursal no encontrada", 404);
    }
  });
}
