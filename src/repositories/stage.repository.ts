import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface StageFilters {
  pipelineId?: string;
  search?: string;
}

export type StageSortBy = "order" | "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// R1.10 — search sobre `name`, mismo patrón que company.repository.ts.
function buildWhere(organizationId: string, filters: StageFilters): Prisma.StageWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
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

export function countStages(organizationId: string, filters: StageFilters, db: Db = prisma) {
  return db.stage.count({ where: buildWhere(organizationId, filters) });
}

export function findStageById(id: string, organizationId: string, db: Db = prisma) {
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

// organizationId además de pipelineId (B-12 de docs/auditoria-2026-08-29.md),
// y también en countStagesByName: las dos deciden si createStage/updateStage
// tiran un 409, así que les aplica el mismo criterio que
// countActiveStagesByPipeline documenta más abajo — "esto decide si una
// escritura procede, así que el aislamiento tiene que estar en su propio
// WHERE y no en el del caller". Con honestidad sobre el alcance: pipelineId
// es un UUID sin colisión posible entre organizaciones y los seis call sites
// ya validan la pertenencia del pipeline antes de llamar, así que esto no
// cambia ningún resultado real hoy — es consistencia y defensa en
// profundidad, no la corrección de una fuga. El respaldo real de los tres
// 409, además, son los índices únicos parciales de la base
// (stages_pipeline_name_unique / _won_ / _lost_); estos pre-checks son la
// versión legible del error.
export function findStageWithFlag(
  pipelineId: string,
  organizationId: string,
  flag: "isWon" | "isLost",
  excludeId?: string,
  db: Db = prisma,
) {
  const exclude = excludeId ? { id: { not: excludeId } } : {};
  return db.stage.findFirst({
    where:
      flag === "isWon"
        ? { pipelineId, organizationId, deletedAt: null, isWon: true, ...exclude }
        : { pipelineId, organizationId, deletedAt: null, isLost: true, ...exclude },
  });
}

export function countStagesByName(
  pipelineId: string,
  organizationId: string,
  name: string,
  excludeId?: string,
  db: Db = prisma,
) {
  return db.stage.count({
    where: {
      pipelineId,
      organizationId,
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

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a
// 404 en el service.
export function updateStage(
  id: string,
  organizationId: string,
  data: UpdateStageData,
  db: Db = prisma,
) {
  return db.stage.updateMany({ where: { id, organizationId }, data });
}

export function softDeleteStage(id: string, organizationId: string, db: Db = prisma) {
  return db.stage.updateMany({
    where: { id, organizationId },
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
// pipelineId en el WHERE de cada escritura (B-12 de
// docs/auditoria-2026-08-29.md), igual que reindexStages y por el mismo
// motivo documentado ahí: la escritura misma es la garantía, no la lectura de
// unas líneas más arriba. A diferencia de reindexStages, acá los ids salen de
// un findMany propio ya filtrado por pipelineId, así que la guarda solo puede
// dispararse si una fila cambió de pipeline ENTRE esa lectura y esta
// escritura — un estado que la API no produce, pero que un update directo a
// la base o un bug futuro sí podrían. Antes, ese caso reescribía en silencio
// el `order` de una fila del pipeline (potencialmente de la organización) al
// que el id sí pertenece; ahora afecta 0 filas y aborta la transacción.
export async function shiftUpFrom(pipelineId: string, targetOrder: number, db: Db): Promise<void> {
  const siblings = await db.stage.findMany({
    where: { pipelineId, deletedAt: null, order: { gte: targetOrder } },
    orderBy: { order: "desc" },
  });

  for (const stage of siblings) {
    const result = await db.stage.updateMany({
      where: { id: stage.id, pipelineId },
      data: { order: stage.order + 1 },
    });
    if (result.count !== 1) {
      throw new Error(`shiftUpFrom: el stage ${stage.id} no pertenece al pipeline ${pipelineId}`);
    }
  }
}

// Borrar: cierra el hueco que deja un stage eliminado en `removedOrder`,
// decrementando en 1 el order de todos los posteriores — procesando del más
// bajo al más alto, mismo razonamiento que shiftUpFrom pero al revés.
// Mismo cierre de B-12 que shiftUpFrom — ver el comentario de arriba.
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
    const result = await db.stage.updateMany({
      where: { id: stage.id, pipelineId },
      data: { order: stage.order - 1 },
    });
    if (result.count !== 1) {
      throw new Error(
        `shiftDownAfter: el stage ${stage.id} no pertenece al pipeline ${pipelineId}`,
      );
    }
  }
}

// Actualizar: reordenamiento general. Recibe TODOS los stages activos del
// pipeline, ids en el orden final deseado, y les asigna 1..N. Dos fases
// (offset negativo, después el valor real) porque un movimiento arbitrario
// puede requerir que varios stages intercambien posiciones a la vez, y la
// constraint única (pipeline_id, order) se evalúa por statement, no al
// final de la transacción — un solo UPDATE con el order "final" de otro
// stage todavía ocupado la rechazaría.
//
// pipelineId en el WHERE de cada escritura (M4): a diferencia de
// shiftUpFrom/shiftDownAfter, esta función no hace ninguna query propia
// para derivar el set de filas a tocar — recibe orderedStageIds ya armado
// por el caller y escribía directo por id. organizationId no es la
// frontera correcta acá: Stage.organizationId está denormalizado desde
// pipeline.organizationId y un stage nunca cambia de pipeline vía la API
// (ver docs/project-overview.md sección 4), así que pipelineId ya es el
// scope mínimo y suficiente — agregar organizationId además no angostaría
// nada, sería estético. Si algún id de orderedStageIds no pertenece
// realmente a pipelineId (bug del caller, condición de carrera, o un id
// ajeno), la escritura de esa fila afecta 0 filas — count !== 1 aborta la
// transacción con un error, en vez de reindexar en silencio el pipeline
// (potencialmente de otra organización) al que ese id sí pertenece.
export async function reindexStages(
  pipelineId: string,
  orderedStageIds: string[],
  db: Db,
): Promise<void> {
  for (let i = 0; i < orderedStageIds.length; i++) {
    const result = await db.stage.updateMany({
      where: { id: orderedStageIds[i], pipelineId },
      data: { order: -(i + 1) },
    });
    if (result.count !== 1) {
      throw new Error(
        `reindexStages: el stage ${orderedStageIds[i]} no pertenece al pipeline ${pipelineId}`,
      );
    }
  }

  for (let i = 0; i < orderedStageIds.length; i++) {
    const result = await db.stage.updateMany({
      where: { id: orderedStageIds[i], pipelineId },
      data: { order: i + 1 },
    });
    if (result.count !== 1) {
      throw new Error(
        `reindexStages: el stage ${orderedStageIds[i]} no pertenece al pipeline ${pipelineId}`,
      );
    }
  }
}

// Stages activos de un pipeline — el conteo sobre el que decide el RESTRICT de
// deletePipeline (ALTO-8). Exige organizationId además de pipelineId: a
// diferencia de findStagesByPipeline, esto decide si una escritura procede, así
// que el aislamiento tiene que estar en su propio WHERE y no en el del caller.
export function countActiveStagesByPipeline(
  pipelineId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.stage.count({ where: { pipelineId, organizationId, deletedAt: null } });
}

// Punto de serialización de la relación Stage -> Opportunity (ALTO-8): lockea
// la fila del Stage con SELECT ... FOR UPDATE. Mismo razonamiento que
// lockPipelineForUpdate en pipeline.repository.ts — el RESTRICT de deleteStage
// decide sobre un conteo, y sin serializar contra createOpportunity /
// updateOpportunity el conteo se puede quedar viejo entre que se lee y que se
// escribe.
//
// Sin default para `db`: fuera de una transacción el lock se libera al
// instante.
export async function lockStageForUpdate(
  id: string,
  organizationId: string,
  db: Db,
): Promise<void> {
  // Cero filas = no se bloqueó nada; ver lockOrganizationForUpdate (B-17).
  const filas = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM stages WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  if (filas.length === 0) {
    throw new Error(
      `lockStageForUpdate: no existe el stage ${id} en la organización ${organizationId} — no se tomó ningún lock`,
    );
  }
}
