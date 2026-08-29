import type { ResourceType } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import {
  countResources,
  createResource as createResourceRepo,
  findManyResources,
  findResourceById,
  lockResourceForUpdate,
  softDeleteResource,
  updateResource as updateResourceRepo,
  type ResourceFilters,
  type ResourceSortBy,
  type SortOrder,
} from "../repositories/resource.repository";
import { countActiveServiceTypesByResource } from "../repositories/serviceType.repository";
import { AppError } from "../utils/AppError";

export interface ListResourcesParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  type?: ResourceType;
  sortBy: ResourceSortBy;
  sortOrder: SortOrder;
}

export async function listResources(organizationId: string, params: ListResourcesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyResources(
      organizationId,
      filters as ResourceFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countResources(organizationId, filters as ResourceFilters),
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

export async function getResourceById(organizationId: string, id: string) {
  const resource = await findResourceById(id, organizationId);
  if (!resource) {
    throw new AppError("Recurso no encontrado", 404);
  }
  return resource;
}

// `db` explícito para poder revalidar DENTRO de la transacción de createResource
// con el lock de la sucursal ya sostenido; el default es el pre-check rápido de
// afuera, que es UX y no la defensa. Mismo patrón que validatePipelineId en
// stage.service.ts.
async function validateBranchId(organizationId: string, branchId: string, db: Db = prisma) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

export interface CreateResourceInput {
  branchId: string;
  name: string;
  type: ResourceType;
}

export async function createResource(organizationId: string, input: CreateResourceInput) {
  // 400 rápido en el caso común, sin abrir transacción.
  await validateBranchId(organizationId, input.branchId);

  return prisma.$transaction(async (tx) => {
    // La otra mitad del RESTRICT de deleteBranch. Sin este lock, dos requests
    // concurrentes —uno creando el recurso, otro borrando la sucursal— pasan los
    // dos su chequeo y el recurso queda colgando de una sucursal borrada.
    await lockBranchForUpdate(input.branchId, organizationId, tx);

    // Revalida con el lock sostenido: entre el pre-check y este punto,
    // deleteBranch pudo haber borrado la sucursal. Sin esto, su RESTRICT sería
    // evitable con solo llegar primero.
    await validateBranchId(organizationId, input.branchId, tx);

    return createResourceRepo(
      {
        organizationId,
        branchId: input.branchId,
        name: input.name,
        type: input.type,
      },
      tx,
    );
  });
}

// SIN branchId: un Resource NO cambia de sucursal, y es una decisión, no un
// olvido.
//
// Moverlo de sucursal dejaría a cada ServiceType que lo usa apuntando a un
// recurso de OTRA sucursal — exactamente la inconsistencia que
// validateResourceId de serviceType.service.ts existe para impedir, colada por
// la puerta de atrás y sin que nadie la vea. Mover un recurso de verdad implica
// mover también todos sus servicios, que es una operación distinta y más
// grande; hoy el camino honesto es crear el recurso en la sucursal nueva y
// borrar el viejo, que el RESTRICT obliga a hacer en el orden correcto.
export interface UpdateResourceInput {
  name?: string;
  type?: ResourceType;
}

export async function updateResource(
  organizationId: string,
  id: string,
  input: UpdateResourceInput,
) {
  await getResourceById(organizationId, id);

  const result = await updateResourceRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError("Recurso no encontrado", 404);
  }

  return getResourceById(organizationId, id);
}

// RESTRICT lógico: no se borra un recurso que tiene servicios activos
// apuntándole. Mismo criterio, mismo formato de error y mismo lock de fila que
// deleteBranch y que los dos RESTRICT de ALTO-8.
export async function deleteResource(organizationId: string, id: string) {
  await getResourceById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockResourceForUpdate(id, organizationId, tx);

    const resource = await findResourceById(id, organizationId, tx);
    if (!resource) {
      throw new AppError("Recurso no encontrado", 404);
    }

    const serviciosActivos = await countActiveServiceTypesByResource(id, organizationId, tx);
    if (serviciosActivos > 0) {
      throw new AppError(
        "No se puede eliminar un recurso que tiene servicios activos. Eliminá primero sus servicios.",
        400,
      );
    }

    const result = await softDeleteResource(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Recurso no encontrado", 404);
    }
  });
}
