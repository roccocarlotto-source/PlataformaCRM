import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findPipelineById } from "../repositories/pipeline.repository";
import {
  countStages,
  countStagesByName,
  createStage as createStageRepo,
  findManyStages,
  findStageById,
  findStagesByPipeline,
  findStageWithFlag,
  reindexStages,
  shiftDownAfter,
  shiftUpFrom,
  softDeleteStage,
  updateStage as updateStageRepo,
  type StageSortBy,
  type SortOrder,
} from "../repositories/stage.repository";
import { AppError } from "../utils/AppError";

export interface ListStagesParams {
  page: number;
  pageSize: number;
  pipelineId?: string;
  search?: string;
  sortBy: StageSortBy;
  sortOrder: SortOrder;
}

export async function listStages(organizationId: string, params: ListStagesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyStages(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countStages(organizationId, filters),
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

export async function getStageById(organizationId: string, id: string) {
  const stage = await findStageById(id, organizationId);
  if (!stage) {
    throw new AppError("Etapa no encontrada", 404);
  }
  return stage;
}

async function validatePipelineId(organizationId: string, pipelineId: string) {
  const pipeline = await findPipelineById(pipelineId, organizationId);
  if (!pipeline) {
    throw new AppError("El pipelineId indicado no existe o no pertenece a tu organización", 400);
  }
  return pipeline;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Reordenamiento: dada la lista de hermanos tal como está hoy en la base
// (ordenada por `order` asc, sin borrados), devuelve la lista final de ids
// en el orden en que deben quedar después de mover `movedId` a
// `requestedOrder`. Es el cálculo puro del reordenamiento, sin base: quien
// llama se ocupa de leer los hermanos y de persistir el resultado con
// `reindexStages`.
//
// `requestedOrder` se acota a [1, siblings.length]: un orden fuera de rango
// no es un error, se interpreta como "al principio" o "al final".
//
// Exportada para poder testearla sin base (stage.service.test.ts). Recibe
// los hermanos en vez de leerlos adentro también porque el fix de ALTO-5
// (reordenamiento sin lock) tiene que poder cambiar dónde y cómo se hace esa
// lectura sin tocar el cálculo.
export function computeFinalOrderIds(
  siblings: readonly { id: string }[],
  movedId: string,
  requestedOrder: number,
): string[] {
  const targetOrder = clamp(requestedOrder, 1, siblings.length);

  const withoutMoved = siblings.filter((s) => s.id !== movedId);
  return [
    ...withoutMoved.slice(0, targetOrder - 1).map((s) => s.id),
    movedId,
    ...withoutMoved.slice(targetOrder - 1).map((s) => s.id),
  ];
}

// Único índice de unicidad que Stage puede violar en una carrera (nombre,
// isWon, isLost — order nunca choca porque el reindexado lo maneja
// siempre): traduce la violación a un 409 legible en vez de un 500 crudo.
//
// T-2 (auditoría nueva): además del índice único de arriba, Stage tiene un
// CHECK (stages_won_lost_exclusive_check, manual_constraints.sql) que
// findStageWithFlag no puede reemplazar — ese pre-check solo mira OTRAS
// filas del pipeline, nunca el propio flag opuesto de la fila que se está
// actualizando, así que dos escrituras (una marca isWon, otra marca
// isLost, sobre la misma etapa) pueden pasar las dos su chequeo y chocar
// recién en la escritura real. Un CHECK no expone `meta.target` como
// P2002, así que se reconoce por el nombre exacto de la constraint dentro
// de `err.message` (única superficie estable disponible para un
// PrismaClientUnknownRequestError en @prisma/client 5.22.0, verificado
// empíricamente) — nunca por el texto humano completo del mensaje, para
// no absorber ningún otro error por accidente. Mismo detalle que en
// activity.service.ts: las comillas que Postgres pone alrededor del
// nombre de la constraint quedan escapadas con una barra invertida
// literal en el string que expone Prisma
// (`\"stages_won_lost_exclusive_check\"`, no `"..."` a secas). La
// traducción de P2002 de arriba queda intacta.
//
// Exportada para poder testear la traducción sin base (stage.service.test.ts).
export function rethrowAsConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("name")) {
      throw new AppError("Ya existe una etapa con ese nombre en este pipeline", 409);
    }
    if (target.includes("won")) {
      throw new AppError("Ya existe una etapa marcada como ganada en este pipeline", 409);
    }
    if (target.includes("lost")) {
      throw new AppError("Ya existe una etapa marcada como perdida en este pipeline", 409);
    }
    throw new AppError("El registro ya existe", 409);
  }

  if (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    err.message.includes('\\"stages_won_lost_exclusive_check\\"')
  ) {
    throw new AppError("Esta etapa no puede quedar marcada como ganada y perdida a la vez", 409);
  }

  throw err;
}

export interface CreateStageInput {
  pipelineId: string;
  name: string;
  order?: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export async function createStage(organizationId: string, input: CreateStageInput) {
  await validatePipelineId(organizationId, input.pipelineId);

  const existingByName = await countStagesByName(input.pipelineId, input.name);
  if (existingByName > 0) {
    throw new AppError("Ya existe una etapa con ese nombre en este pipeline", 409);
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(input.pipelineId, "isWon");
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como ganada en este pipeline", 409);
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(input.pipelineId, "isLost");
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como perdida en este pipeline", 409);
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const siblings = await findStagesByPipeline(input.pipelineId, tx);
      const targetOrder = clamp(input.order ?? siblings.length + 1, 1, siblings.length + 1);

      // No-op si targetOrder es el siguiente libre (append al final) — solo
      // mueve hermanos cuando realmente hace falta abrir un lugar.
      await shiftUpFrom(input.pipelineId, targetOrder, tx);

      return createStageRepo(
        {
          organizationId,
          pipelineId: input.pipelineId,
          name: input.name,
          order: targetOrder,
          probability: input.probability,
          isWon: input.isWon,
          isLost: input.isLost,
        },
        tx,
      );
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

export interface UpdateStageInput {
  name?: string;
  order?: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export async function updateStage(organizationId: string, id: string, input: UpdateStageInput) {
  const stage = await getStageById(organizationId, id);

  if (input.name && input.name !== stage.name) {
    const existingByName = await countStagesByName(stage.pipelineId, input.name, id);
    if (existingByName > 0) {
      throw new AppError("Ya existe una etapa con ese nombre en este pipeline", 409);
    }
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(stage.pipelineId, "isWon", id);
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como ganada en este pipeline", 409);
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(stage.pipelineId, "isLost", id);
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como perdida en este pipeline", 409);
    }
  }

  const { order: requestedOrder, ...rest } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      if (requestedOrder !== undefined && requestedOrder !== stage.order) {
        const siblings = await findStagesByPipeline(stage.pipelineId, tx);
        const finalOrderIds = computeFinalOrderIds(siblings, id, requestedOrder);

        await reindexStages(stage.pipelineId, finalOrderIds, tx);
      }

      const result = await updateStageRepo(id, organizationId, rest, tx);
      if (result.count === 0) {
        throw new AppError("Etapa no encontrada", 404);
      }

      const updated = await findStageById(id, organizationId, tx);
      if (!updated) {
        throw new AppError("Etapa no encontrada", 404);
      }
      return updated;
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

export async function deleteStage(organizationId: string, id: string) {
  const stage = await getStageById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    const result = await softDeleteStage(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Etapa no encontrada", 404);
    }
    await shiftDownAfter(stage.pipelineId, stage.order, tx);
  });
}
