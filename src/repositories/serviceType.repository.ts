import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface ServiceTypeFilters {
  search?: string;
  branchId?: string;
  resourceId?: string;
}

export type ServiceTypeSortBy = "name" | "createdAt" | "durationMin";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: ServiceTypeFilters,
): Prisma.ServiceTypeWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
  };
}

function buildOrderBy(
  sortBy: ServiceTypeSortBy,
  sortOrder: SortOrder,
): Prisma.ServiceTypeOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "durationMin":
      return { durationMin: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyServiceTypes(
  organizationId: string,
  filters: ServiceTypeFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ServiceTypeSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.serviceType.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countServiceTypes(
  organizationId: string,
  filters: ServiceTypeFilters,
  db: Db = prisma,
) {
  return db.serviceType.count({ where: buildWhere(organizationId, filters) });
}

export function findServiceTypeById(id: string, organizationId: string, db: Db = prisma) {
  return db.serviceType.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// Los dos conteos sobre los que deciden los RESTRICT de deleteBranch y
// deleteResource. organizationId en el WHERE por el mismo motivo que en
// countActiveResourcesByBranch: deciden si una escritura procede.
export function countActiveServiceTypesByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.serviceType.count({ where: { branchId, organizationId, deletedAt: null } });
}

export function countActiveServiceTypesByResource(
  resourceId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.serviceType.count({ where: { resourceId, organizationId, deletedAt: null } });
}

export interface CreateServiceTypeData {
  organizationId: string;
  branchId: string;
  resourceId: string;
  name: string;
  durationMin: number;
  capacity?: number;
}

export function createServiceType(data: CreateServiceTypeData, db: Db = prisma) {
  return db.serviceType.create({ data });
}

export interface UpdateServiceTypeData {
  branchId?: string;
  resourceId?: string;
  name?: string;
  durationMin?: number;
  capacity?: number;
}

export function updateServiceType(
  id: string,
  organizationId: string,
  data: UpdateServiceTypeData,
  db: Db = prisma,
) {
  return db.serviceType.updateMany({ where: { id }, data });
}

export function softDeleteServiceType(id: string, organizationId: string, db: Db = prisma) {
  return db.serviceType.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}

// Punto de serialización de la relación ServiceType -> Booking. Cierra el
// pendiente (2) que PR #41 dejó anotado: entonces no existía porque no había
// nada contra qué serializar.
//
// Mismo razonamiento que lockBranchForUpdate y lockResourceForUpdate: el
// RESTRICT de deleteServiceType decide sobre un CONTEO de reservas activas, y
// sin serializar contra createBooking ese conteo se queda viejo entre que se lee
// y que se escribe — el bloqueo sería evitable con solo llegar primero, que es
// la lección de ALTO-8.
//
// ORDEN: siempre DESPUÉS del lock de resource cuando se toman los dos
// (createBooking). Ningún camino toma serviceType antes que resource.
//
// Sin default para `db`: fuera de una transacción el lock se libera al instante.
export async function lockServiceTypeForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM service_types WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
}
