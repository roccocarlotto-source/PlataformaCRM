import type { Prisma, ResourceType } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ResourceFilters {
  search?: string;
  branchId?: string;
  type?: ResourceType;
}

export type ResourceSortBy = "name" | "createdAt" | "type";
export type SortOrder = "asc" | "desc";

function buildWhere(organizationId: string, filters: ResourceFilters): Prisma.ResourceWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };
}

function buildOrderBy(
  sortBy: ResourceSortBy,
  sortOrder: SortOrder,
): Prisma.ResourceOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "type":
      return { type: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyResources(
  organizationId: string,
  filters: ResourceFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ResourceSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.resource.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countResources(organizationId: string, filters: ResourceFilters, db: Db = prisma) {
  return db.resource.count({ where: buildWhere(organizationId, filters) });
}

export function findResourceById(id: string, organizationId: string, db: Db = prisma) {
  return db.resource.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// Recursos activos de una sucursal — el conteo sobre el que decide el RESTRICT
// de deleteBranch. Exige organizationId además de branchId: esto decide si una
// escritura procede, así que el aislamiento tiene que estar en su propio WHERE
// y no en el del caller (mismo criterio que countActiveStagesByPipeline).
export function countActiveResourcesByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.resource.count({ where: { branchId, organizationId, deletedAt: null } });
}

export interface CreateResourceData {
  organizationId: string;
  branchId: string;
  name: string;
  type: ResourceType;
}

export function createResource(data: CreateResourceData, db: Db = prisma) {
  return db.resource.create({ data });
}

// Sin branchId: un Resource NO cambia de sucursal. Ver la nota en
// resource.service.ts sobre por qué es inmutable.
export interface UpdateResourceData {
  name?: string;
  type?: ResourceType;
}

export function updateResource(
  id: string,
  organizationId: string,
  data: UpdateResourceData,
  db: Db = prisma,
) {
  return db.resource.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteResource(id: string, organizationId: string, db: Db = prisma) {
  return db.resource.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}

// Punto de serialización de la relación Resource -> ServiceType. Mismo
// razonamiento que lockBranchForUpdate: el RESTRICT de deleteResource decide
// sobre un conteo, y sin serializar contra createServiceType ese conteo se
// queda viejo entre que se lee y que se escribe.
//
// ORDEN: siempre DESPUÉS del lock de branch cuando se toman los dos
// (createServiceType). Ningún camino toma resource antes que branch.
//
// Sin default para `db`: fuera de una transacción el lock se libera al instante.
export async function lockResourceForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM resources WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
}
