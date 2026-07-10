import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface StageFilters {
  pipelineId?: string;
}

export type StageSortBy = "order" | "name" | "createdAt";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: StageFilters,
): Prisma.StageWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
  };
}

function buildOrderBy(
  sortBy: StageSortBy,
  sortOrder: SortOrder,
): Prisma.StageOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
      return { createdAt: sortOrder };
    case "order":
    default:
      return { order: sortOrder };
  }
}

export function findManyStages(
  organizationId: string,
  filters: StageFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: StageSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.stage.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countStages(
  organizationId: string,
  filters: StageFilters,
  db: Db = prisma,
) {
  return db.stage.count({ where: buildWhere(organizationId, filters) });
}

export function findStageById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.stage.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

// Todos los stages activos de un pipeline, ordenados — base del
// reindexado. No filtra por organizationId: el caller (service) ya validó
// que el pipeline pertenece a la organización antes de llegar acá.
export function findStagesByPipeline(pipelineId: string, db: Db = prisma) {
  return db.stage.findMany({
    where: { pipelineId, deletedAt: null },
    orderBy: { order: "asc" },
  });
}

export function findStageWithFlag(
  pipelineId: string,
  flag: "isWon" | "isLost",
  excludeId?: string,
  db: Db = prisma,
) {
  const exclude = excludeId ? { id: { not: excludeId } } : {};
  return db.stage.findFirst({
    where:
      flag === "isWon"
        ? { pipelineId, deletedAt: null, isWon: true, ...exclude }
        : { pipelineId, deletedAt: null, isLost: true, ...exclude },
  });
}

export function countStagesByName(
  pipelineId: string,
  name: string,
  excludeId?: string,
  db: Db = prisma,
) {
  return db.stage.count({
    where: {
      pipelineId,
      deletedAt: null,
      name,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export interface CreateStageData {
  organizationId: string;
  pipelineId: string;
  name: string;
  order: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export function createStage(data: CreateStageData, db: Db = prisma) {
  return db.stage.create({ data });
}

export interface UpdateStageData {
  name?: string;
  order?: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export function updateStage(
  id: string,
  data: UpdateStageData,
  db: Db = prisma,
) {
  return db.stage.update({ where: { id }, data });
}

export function softDeleteStage(id: string, db: Db = prisma) {
  return db.stage.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Reindexado de `order`. Las tres funciones de acá abajo asumen que corren
// dentro de una transacción (no tienen default para `db`, a propósito: no
// deberían usarse sueltas fuera de una) — ver stage.service.ts.
// ---------------------------------------------------------------------------

// Crear: hace lugar para un stage nuevo en `targetOrder`, incrementando en 1
// el order de todos los que están en esa posición o después — procesando
// del más alto al más bajo, cada casillero de destino ya quedó libre por el
// paso anterior, nunca choca contra la constraint única.
export async function shiftUpFrom(
  pipelineId: string,
  targetOrder: number,
  db: Db,
): Promise<void> {
  const siblings = await db.stage.findMany({
    where: { pipelineId, deletedAt: null, order: { gte: targetOrder } },
    orderBy: { order: "desc" },
  });

  for (const stage of siblings) {
    await db.stage.update({
      where: { id: stage.id },
      data: { order: stage.order + 1 },
    });
  }
}

// Borrar: cierra el hueco que deja un stage eliminado en `removedOrder`,
// decrementando en 1 el order de todos los posteriores — procesando del más
// bajo al más alto, mismo razonamiento que shiftUpFrom pero al revés.
export async function shiftDownAfter(
  pipelineId: string,
  removedOrder: number,
  db: Db,
): Promise<void> {
  const siblings = await db.stage.findMany({
    where: { pipelineId, deletedAt: null, order: { gt: removedOrder } },
    orderBy: { order: "asc" },
  });

  for (const stage of siblings) {
    await db.stage.update({
      where: { id: stage.id },
      data: { order: stage.order - 1 },
    });
  }
}

// Actualizar: reordenamiento general. Recibe TODOS los stages activos del
// pipeline, ids en el orden final deseado, y les asigna 1..N. Dos fases
// (offset negativo, después el valor real) porque un movimiento arbitrario
// puede requerir que varios stages intercambien posiciones a la vez, y la
// constraint única (pipeline_id, order) se evalúa por statement, no al
// final de la transacción — un solo UPDATE con el order "final" de otro
// stage todavía ocupado la rechazaría.
export async function reindexStages(
  orderedStageIds: string[],
  db: Db,
): Promise<void> {
  for (let i = 0; i < orderedStageIds.length; i++) {
    await db.stage.update({
      where: { id: orderedStageIds[i] },
      data: { order: -(i + 1) },
    });
  }

  for (let i = 0; i < orderedStageIds.length; i++) {
    await db.stage.update({
      where: { id: orderedStageIds[i] },
      data: { order: i + 1 },
    });
  }
}
