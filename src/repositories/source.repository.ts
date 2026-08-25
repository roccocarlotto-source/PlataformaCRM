import type { Prisma, SourceType } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface SourceFilters {
  search?: string;
  type?: SourceType;
  isActive?: boolean;
}

export type SourceSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// Proyección explícita, no la fila cruda de Prisma. DIVERGENCIA DELIBERADA con
// los 8 módulos existentes, que devuelven `select`-less y por lo tanto exponen
// deletedAt (hallazgo BAJO de la auditoría): acá la lista de columnas
// expuestas vive en UN solo lugar, y una columna nueva no empieza a salir por
// la API sola — hay que agregarla acá a propósito. Mismo criterio con el que
// los índices de estas tablas nacieron bien mientras las viejas siguen sin los
// suyos: lo nuevo no hereda el defecto de lo viejo. No armonizar hacia atrás.
//
// fieldMapping queda AFUERA a propósito: es una columna que todavía nadie
// escribe y cuya forma define el ítem 4 (ver el listado de columnas sin
// escribir en la bitácora). Exponer un JSONB sin semántica definida es
// comprometerse con un contrato que todavía no existe.
const SOURCE_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  type: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SourceSelect;

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir.
function buildWhere(
  organizationId: string,
  filters: SourceFilters,
): Prisma.SourceWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: SourceSortBy,
  sortOrder: SortOrder,
): Prisma.SourceOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManySources(
  organizationId: string,
  filters: SourceFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: SourceSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.source.findMany({
    where: buildWhere(organizationId, filters),
    select: SOURCE_PUBLIC_SELECT,
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countSources(
  organizationId: string,
  filters: SourceFilters,
  db: Db = prisma,
) {
  return db.source.count({ where: buildWhere(organizationId, filters) });
}

export function findSourceById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.source.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: SOURCE_PUBLIC_SELECT,
  });
}

export interface CreateSourceData {
  organizationId: string;
  name: string;
  type: SourceType;
  isActive?: boolean;
}

export function createSource(data: CreateSourceData, db: Db = prisma) {
  return db.source.create({ data, select: SOURCE_PUBLIC_SELECT });
}

export interface UpdateSourceData {
  name?: string;
  isActive?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id, para que la escritura en sí (no solo el
// pre-check del service) sea la garantía real de aislamiento multi-tenant
// (M4). count === 0 significa "no existe, no es de esta organización, o ya no
// está donde el pre-check la vio" — el service lo traduce a 404.
export function updateSource(
  id: string,
  organizationId: string,
  data: UpdateSourceData,
  db: Db = prisma,
) {
  return db.source.updateMany({
    where: { id, organizationId, deletedAt: null },
    data,
  });
}

export function softDeleteSource(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.source.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
