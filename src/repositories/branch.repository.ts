import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface BranchFilters {
  search?: string;
}

export type BranchSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir.
function buildWhere(organizationId: string, filters: BranchFilters): Prisma.BranchWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
  };
}

function buildOrderBy(
  sortBy: BranchSortBy,
  sortOrder: SortOrder,
): Prisma.BranchOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyBranches(
  organizationId: string,
  filters: BranchFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: BranchSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.branch.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countBranches(organizationId: string, filters: BranchFilters, db: Db = prisma) {
  return db.branch.count({ where: buildWhere(organizationId, filters) });
}

export function findBranchById(id: string, organizationId: string, db: Db = prisma) {
  return db.branch.findFirst({ where: { id, organizationId, deletedAt: null } });
}

export interface CreateBranchData {
  organizationId: string;
  name: string;
  timezone: string;
}

export function createBranch(data: CreateBranchData, db: Db = prisma) {
  return db.branch.create({ data });
}

export interface UpdateBranchData {
  name?: string;
  timezone?: string;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a 404.
export function updateBranch(
  id: string,
  organizationId: string,
  data: UpdateBranchData,
  db: Db = prisma,
) {
  return db.branch.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteBranch(id: string, organizationId: string, db: Db = prisma) {
  return db.branch.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date() },
  });
}

// Punto de serialización de las relaciones Branch -> Resource y
// Branch -> ServiceType, con el mismo mecanismo y el mismo razonamiento que
// lockPipelineForUpdate (ALTO-8).
//
// El RESTRICT de deleteBranch decide sobre CONTEOS, y un conteo sin punto de
// serialización no decide nada: entre leerlo y escribir, otra transacción
// inserta la fila que lo habría cambiado. Sin este lock, createResource podría
// colar un recurso entre el conteo y el borrado, y la organización quedaría con
// un Resource activo colgando de una Branch borrada.
//
// De FILA y no de organización: un lock de organización serializaría la
// creación de recursos de TODAS las sucursales del tenant contra el borrado de
// cualquiera. Éste solo serializa lo que de verdad compite.
//
// ORDEN DE LOCKS EN ESTE MÓDULO, para que no haya deadlock: siempre
// branch ANTES que resource. createServiceType es el único camino que toma los
// dos, y los toma en ese orden; ningún otro toma resource antes que branch.
//
// Sin default para `db`: fuera de una transacción el lock se libera al
// instante y no sirve para nada.
export async function lockBranchForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM branches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
}
