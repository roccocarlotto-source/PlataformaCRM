import { prisma } from "../lib/prisma";
import {
  countActivePipelines,
  countPipelines,
  createPipeline as createPipelineRepo,
  findManyPipelines,
  findOldestActivePipeline,
  findPipelineById,
  softDeletePipeline,
  unsetDefaultPipeline,
  updatePipeline as updatePipelineRepo,
  type PipelineSortBy,
  type SortOrder,
} from "../repositories/pipeline.repository";
import { AppError } from "../utils/AppError";

export interface ListPipelinesParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: PipelineSortBy;
  sortOrder: SortOrder;
}

export async function listPipelines(
  organizationId: string,
  params: ListPipelinesParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyPipelines(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countPipelines(organizationId, filters),
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

export async function getPipelineById(organizationId: string, id: string) {
  const pipeline = await findPipelineById(id, organizationId);
  if (!pipeline) {
    throw new AppError("Pipeline no encontrado", 404);
  }
  return pipeline;
}

export interface CreatePipelineInput {
  name: string;
  isDefault?: boolean;
}

export async function createPipeline(
  organizationId: string,
  input: CreatePipelineInput,
) {
  if (input.isDefault) {
    return prisma.$transaction(async (tx) => {
      // Desmarcar el default anterior ANTES de crear el nuevo: nunca hay
      // dos `is_default = true` simultáneos, sin necesitar dos fases.
      await unsetDefaultPipeline(organizationId, tx);
      return createPipelineRepo(
        { organizationId, name: input.name, isDefault: true },
        tx,
      );
    });
  }

  return createPipelineRepo({
    organizationId,
    name: input.name,
    isDefault: false,
  });
}

export interface UpdatePipelineInput {
  name?: string;
  isDefault?: boolean;
}

export async function updatePipeline(
  organizationId: string,
  id: string,
  input: UpdatePipelineInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrado.
  await getPipelineById(organizationId, id);

  if (input.isDefault === true) {
    return prisma.$transaction(async (tx) => {
      await unsetDefaultPipeline(organizationId, tx);
      return updatePipelineRepo(id, input, tx);
    });
  }

  return updatePipelineRepo(id, input);
}

export async function deletePipeline(organizationId: string, id: string) {
  const pipeline = await getPipelineById(organizationId, id);

  const activeCount = await countActivePipelines(organizationId);
  if (activeCount <= 1) {
    throw new AppError(
      "No se puede eliminar el último pipeline de la organización",
      400,
    );
  }

  if (!pipeline.isDefault) {
    await softDeletePipeline(id);
    return;
  }

  // Este pipeline era el default: promover el más antiguo de los que
  // quedan, para que la organización nunca se quede sin uno, en la misma
  // transacción que el borrado. Orden importa: primero el soft delete (que
  // saca a este pipeline del alcance del índice único parcial, ya que
  // excluye deleted_at IS NOT NULL), recién después marcar el nuevo
  // default — si lo hiciéramos al revés, habría un instante con dos filas
  // `is_default = true` simultáneas y la constraint lo rechazaría.
  await prisma.$transaction(async (tx) => {
    await softDeletePipeline(id, tx);

    const nextDefault = await findOldestActivePipeline(
      organizationId,
      id,
      tx,
    );
    if (nextDefault) {
      await updatePipelineRepo(nextDefault.id, { isDefault: true }, tx);
    }
  });
}
