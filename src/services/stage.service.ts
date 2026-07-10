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
  sortBy: StageSortBy;
  sortOrder: SortOrder;
}

export async function listStages(
  organizationId: string,
  params: ListStagesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyStages(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
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
    throw new AppError(
      "El pipelineId indicado no existe o no pertenece a tu organización",
      400,
    );
  }
  return pipeline;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Único índice de unicidad que Stage puede violar en una carrera (nombre,
// isWon, isLost — order nunca choca porque el reindexado lo maneja
// siempre): traduce la violación a un 409 legible en vez de un 500 crudo.
function rethrowAsConflict(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("name")) {
      throw new AppError(
        "Ya existe una etapa con ese nombre en este pipeline",
        409,
      );
    }
    if (target.includes("won")) {
      throw new AppError(
        "Ya existe una etapa marcada como ganada en este pipeline",
        409,
      );
    }
    if (target.includes("lost")) {
      throw new AppError(
        "Ya existe una etapa marcada como perdida en este pipeline",
        409,
      );
    }
    throw new AppError("El registro ya existe", 409);
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

export async function createStage(
  organizationId: string,
  input: CreateStageInput,
) {
  await validatePipelineId(organizationId, input.pipelineId);

  const existingByName = await countStagesByName(
    input.pipelineId,
    input.name,
  );
  if (existingByName > 0) {
    throw new AppError(
      "Ya existe una etapa con ese nombre en este pipeline",
      409,
    );
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(input.pipelineId, "isWon");
    if (existing) {
      throw new AppError(
        "Ya existe una etapa marcada como ganada en este pipeline",
        409,
      );
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(input.pipelineId, "isLost");
    if (existing) {
      throw new AppError(
        "Ya existe una etapa marcada como perdida en este pipeline",
        409,
      );
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const siblings = await findStagesByPipeline(input.pipelineId, tx);
      const targetOrder = clamp(
        input.order ?? siblings.length + 1,
        1,
        siblings.length + 1,
      );

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

export async function updateStage(
  organizationId: string,
  id: string,
  input: UpdateStageInput,
) {
  const stage = await getStageById(organizationId, id);

  if (input.name && input.name !== stage.name) {
    const existingByName = await countStagesByName(
      stage.pipelineId,
      input.name,
      id,
    );
    if (existingByName > 0) {
      throw new AppError(
        "Ya existe una etapa con ese nombre en este pipeline",
        409,
      );
    }
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(stage.pipelineId, "isWon", id);
    if (existing) {
      throw new AppError(
        "Ya existe una etapa marcada como ganada en este pipeline",
        409,
      );
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(stage.pipelineId, "isLost", id);
    if (existing) {
      throw new AppError(
        "Ya existe una etapa marcada como perdida en este pipeline",
        409,
      );
    }
  }

  const { order: requestedOrder, ...rest } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      if (requestedOrder !== undefined && requestedOrder !== stage.order) {
        const siblings = await findStagesByPipeline(stage.pipelineId, tx);
        const targetOrder = clamp(requestedOrder, 1, siblings.length);

        const withoutMoved = siblings.filter((s) => s.id !== id);
        const finalOrderIds = [
          ...withoutMoved.slice(0, targetOrder - 1).map((s) => s.id),
          id,
          ...withoutMoved.slice(targetOrder - 1).map((s) => s.id),
        ];

        await reindexStages(finalOrderIds, tx);
      }

      return updateStageRepo(id, rest, tx);
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

export async function deleteStage(organizationId: string, id: string) {
  const stage = await getStageById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await softDeleteStage(id, tx);
    await shiftDownAfter(stage.pipelineId, stage.order, tx);
  });
}
