import { Prisma, type SourceType } from "@prisma/client";
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
// fieldMapping SÍ figura acá desde el ítem 5, que es el que le dio forma
// (schemas/fieldMapping.schema.ts) y consumidor (la traducción de una fila de
// archivo, en promotion.service.ts). El ítem 3 la había dejado afuera porque el
// documento la declaraba "JSONB" y nada más —ni forma, ni claves, ni quién la
// consume— y exponerla entonces habría sido comprometerse con un contrato
// inexistente.
//
// Se expone porque un ADMIN que la configura por PATCH tiene que poder leer qué
// quedó guardado: una columna de configuración que solo se puede escribir es
// una que nadie puede auditar. No contiene secretos — son nombres de columnas
// de una planilla.
const SOURCE_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  type: true,
  isActive: true,
  fieldMapping: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SourceSelect;

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir.
function buildWhere(organizationId: string, filters: SourceFilters): Prisma.SourceWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
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

export function countSources(organizationId: string, filters: SourceFilters, db: Db = prisma) {
  return db.source.count({ where: buildWhere(organizationId, filters) });
}

export function findSourceById(id: string, organizationId: string, db: Db = prisma) {
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
  fieldMapping?: Prisma.InputJsonValue;
}

export function createSource(data: CreateSourceData, db: Db = prisma) {
  return db.source.create({ data, select: SOURCE_PUBLIC_SELECT });
}

export interface UpdateSourceData {
  name?: string;
  isActive?: boolean;
  // Prisma.DbNull escribe SQL NULL (limpiar el mapeo); un objeto lo reemplaza.
  // NO se acepta el `null` de JS a secas: sobre una columna Json nullable Prisma
  // lo interpreta como JSON null, que es un valor PRESENTE y distinto de SQL
  // NULL — la promoción vería "hay un mapeo configurado" y trataría de traducir
  // con él.
  fieldMapping?: Prisma.InputJsonValue | typeof Prisma.DbNull;
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

export function softDeleteSource(id: string, organizationId: string, db: Db = prisma) {
  return db.source.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
