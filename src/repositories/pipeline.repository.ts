import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface PipelineFilters {
  search?: string;
}

export type PipelineSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

function buildWhere(organizationId: string, filters: PipelineFilters): Prisma.PipelineWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
  };
}

function buildOrderBy(
  sortBy: PipelineSortBy,
  sortOrder: SortOrder,
): Prisma.PipelineOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyPipelines(
  organizationId: string,
  filters: PipelineFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: PipelineSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.pipeline.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countPipelines(organizationId: string, filters: PipelineFilters, db: Db = prisma) {
  return db.pipeline.count({ where: buildWhere(organizationId, filters) });
}

export function findPipelineById(id: string, organizationId: string, db: Db = prisma) {
  return db.pipeline.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

export function findDefaultPipeline(organizationId: string, db: Db = prisma) {
  return db.pipeline.findFirst({
    where: { organizationId, isDefault: true, deletedAt: null },
  });
}

// El pipeline activo más antiguo, excluyendo uno dado — usado para
// auto-promover un nuevo default cuando se borra el que lo era.
export function findOldestActivePipeline(
  organizationId: string,
  excludeId: string,
  db: Db = prisma,
) {
  return db.pipeline.findFirst({
    where: { organizationId, deletedAt: null, id: { not: excludeId } },
    orderBy: { createdAt: "asc" },
  });
}

export function countActivePipelines(organizationId: string, db: Db = prisma) {
  return db.pipeline.count({ where: { organizationId, deletedAt: null } });
}

// Desmarca cualquier pipeline que hoy sea default en la organización. Se usa
// siempre ANTES de marcar uno nuevo como default (nunca al revés) — así
// nunca hay dos `is_default = true` simultáneos, sin necesitar el truco de
// dos fases que sí hace falta para reordenar stages.
export function unsetDefaultPipeline(organizationId: string, db: Db = prisma) {
  return db.pipeline.updateMany({
    where: { organizationId, isDefault: true, deletedAt: null },
    data: { isDefault: false },
  });
}

export interface CreatePipelineData {
  organizationId: string;
  name: string;
  isDefault?: boolean;
}

export function createPipeline(data: CreatePipelineData, db: Db = prisma) {
  return db.pipeline.create({ data });
}

export interface UpdatePipelineData {
  name?: string;
  isDefault?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updatePipeline(
  id: string,
  organizationId: string,
  data: UpdatePipelineData,
  db: Db = prisma,
) {
  return db.pipeline.updateMany({ where: { id, organizationId }, data });
}

// PIPE-DEFAULT-GHOST: deletedAt e isDefault: false van en el mismo UPDATE —
// una fila soft-deleted nunca debe poder leerse como default de la
// organización. Sin esto, una fila que era default queda con isDefault:
// true para siempre, porque unsetDefaultPipeline (la única función que
// apaga un default existente) filtra deletedAt: null en su propio WHERE y
// nunca vuelve a alcanzarla.
export function softDeletePipeline(id: string, organizationId: string, db: Db = prisma) {
  return db.pipeline.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date(), isDefault: false },
  });
}

// Punto de serialización de la relación Pipeline -> Stage (ALTO-8): lockea la
// fila del Pipeline con SELECT ... FOR UPDATE.
//
// El RESTRICT de deletePipeline ("no se puede borrar un pipeline con stages
// activos") es una decisión que se toma sobre un CONTEO, así que sin un punto
// de serialización no vale nada: createStage podía insertar un Stage entre el
// conteo y el borrado, y la organización quedaba con un Stage activo colgando
// de un Pipeline borrado — el escenario 2 del hallazgo, por la puerta de
// atrás. Es la misma clase de bug que H-1, y el mismo mecanismo que lo
// resolvió.
//
// LA FILA DEL PIPELINE, NO LA DE LA ORGANIZACIÓN, a diferencia de
// lockOrganizationForUpdate. Un lock de organización serializaría la creación
// de stages de TODOS los pipelines del tenant contra el borrado de cualquiera
// de ellos; éste solo serializa lo que de verdad compite: las escrituras sobre
// un mismo Pipeline. deletePipeline toma los dos —el de organización lo exige
// su propio invariante de "nunca cero pipelines" (H-1)— y siempre en ese orden,
// organización primero, para que no haya dos caminos que los tomen al revés.
//
// Sin default para `db`, mismo criterio que lockOrganizationForUpdate: fuera de
// una transacción el lock se libera al instante y no sirve para nada.
export async function lockPipelineForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<void> {
  // Cero filas = no se bloqueó nada; ver lockOrganizationForUpdate (B-17).
  const filas = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM pipelines WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  if (filas.length === 0) {
    throw new Error(
      `lockPipelineForUpdate: no existe el pipeline ${id} en la organización ${organizationId} — no se tomó ningún lock`,
    );
  }
}
