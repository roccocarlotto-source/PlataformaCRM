import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface PipelineFilters {
  search?: string;
}

export type PipelineSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: PipelineFilters,
): Prisma.PipelineWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
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

export function countPipelines(
  organizationId: string,
  filters: PipelineFilters,
  db: Db = prisma,
) {
  return db.pipeline.count({ where: buildWhere(organizationId, filters) });
}

export function findPipelineById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
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
export function softDeletePipeline(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.pipeline.updateMany({
    where: { id, organizationId },
    data: { deletedAt: new Date(), isDefault: false },
  });
}
