import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  countActivePipelines,
  countPipelines,
  createPipeline as createPipelineRepo,
  findManyPipelines,
  findOldestActivePipeline,
  findPipelineById,
  lockPipelineForUpdate,
  softDeletePipeline,
  unsetDefaultPipeline,
  updatePipeline as updatePipelineRepo,
  type PipelineSortBy,
  type SortOrder,
} from "../repositories/pipeline.repository";
import { countActiveStagesByPipeline } from "../repositories/stage.repository";
import { AppError } from "../utils/AppError";

export interface ListPipelinesParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: PipelineSortBy;
  sortOrder: SortOrder;
}

export async function listPipelines(organizationId: string, params: ListPipelinesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyPipelines(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
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

// Dos índices únicos que Pipeline puede violar (ver manual_constraints.sql
// y schema.prisma): el @@unique de schema.prisma en (organizationId, name)
// reporta target ["organization_id","name"]; el índice parcial manual
// pipelines_org_default_unique en (organizationId) WHERE is_default = true
// reporta target ["organization_id"] a secas — sin "name" — porque no
// incluye esa columna. Se distinguen por eso, mismo criterio que
// stage.service.ts usa para desambiguar entre sus propias constraints.
//
// Exportada para poder testear la traducción sin base (pipeline.service.test.ts).
export function rethrowAsConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("name")) {
      throw new AppError("Ya existe un pipeline con ese nombre en esta organización", 409);
    }
    if (target.includes("organization_id")) {
      throw new AppError("Ya existe un pipeline marcado como default en esta organización", 409);
    }
    throw new AppError("El registro ya existe", 409);
  }

  throw err;
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

export async function createPipeline(organizationId: string, input: CreatePipelineInput) {
  try {
    if (input.isDefault) {
      return await prisma.$transaction(async (tx) => {
        // Desmarcar el default anterior ANTES de crear el nuevo: nunca hay
        // dos `is_default = true` simultáneos, sin necesitar dos fases.
        await unsetDefaultPipeline(organizationId, tx);
        return createPipelineRepo({ organizationId, name: input.name, isDefault: true }, tx);
      });
    }

    return await createPipelineRepo({
      organizationId,
      name: input.name,
      isDefault: false,
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
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

  try {
    if (input.isDefault === true) {
      return await prisma.$transaction(async (tx) => {
        await unsetDefaultPipeline(organizationId, tx);

        const result = await updatePipelineRepo(id, organizationId, input, tx);
        if (result.count === 0) {
          throw new AppError("Pipeline no encontrado", 404);
        }

        const updated = await findPipelineById(id, organizationId, tx);
        if (!updated) {
          throw new AppError("Pipeline no encontrado", 404);
        }
        return updated;
      });
    }

    // M-8 (auditoría 2026-08-29): `isDefault: false` sobre el pipeline que hoy
    // es el default dejaba a la organización sin ninguno. El índice parcial
    // pipelines_org_default_unique impide DOS defaults, no CERO, y
    // deletePipeline se toma el trabajo de promover otro justamente para que
    // nunca haya cero — este camino era el único que podía romper ese
    // invariante sin que nada lo frenara. Decisión: 400, sin auto-promoción
    // (a diferencia del delete, acá no hay un "siguiente" obvio: quien quiere
    // otro default lo marca con `isDefault: true`, que ya desmarca a este).
    //
    // Bajo lockOrganizationForUpdate, el mismo lock de organización que toma
    // deletePipeline: el invariante "hay exactamente un default" es de TODA la
    // organización, y el otro camino que lo mueve —la promoción que hace el
    // delete del default— corre bajo ese lock. Sin él, un PATCH que leyera
    // "no es default" un instante antes de que un delete concurrente lo
    // promoviera escribiría `false` encima de esa promoción y la organización
    // quedaría con cero. Con el lock, o el PATCH pasa antes (y el delete
    // promueve después, dejando `true`) o espera y relee `true` → 400.
    if (input.isDefault === false) {
      return await prisma.$transaction(async (tx) => {
        await lockOrganizationForUpdate(organizationId, tx);

        // Revalida con el lock ya sostenido — el pre-check de arriba es solo
        // el 404 rápido, esta lectura es la que decide.
        const pipeline = await findPipelineById(id, organizationId, tx);
        if (!pipeline) {
          throw new AppError("Pipeline no encontrado", 404);
        }
        if (pipeline.isDefault) {
          throw new AppError(
            "No se puede quitar el default de un pipeline sin marcar antes otro como default",
            400,
          );
        }

        const result = await updatePipelineRepo(id, organizationId, input, tx);
        if (result.count === 0) {
          throw new AppError("Pipeline no encontrado", 404);
        }

        const updated = await findPipelineById(id, organizationId, tx);
        if (!updated) {
          throw new AppError("Pipeline no encontrado", 404);
        }
        return updated;
      });
    }

    const result = await updatePipelineRepo(id, organizationId, input);
    if (result.count === 0) {
      throw new AppError("Pipeline no encontrado", 404);
    }

    return await getPipelineById(organizationId, id);
  } catch (err) {
    rethrowAsConflict(err);
  }
}

// H-1 (auditoría nueva, no H2): countActivePipelines corría fuera de
// cualquier lock/transacción — dos deletePipeline concurrentes sobre dos
// Pipelines distintos de la misma organización podían leer el mismo
// conteo antes de que cualquiera de las dos commiteara, y ambas proceder,
// dejando la organización con 0 Pipelines activos (reproducido
// empíricamente 24/25 veces contra Postgres real durante la auditoría).
// Mismo mecanismo que M3 (lockOrganizationForUpdate, SELECT ... FOR UPDATE
// sobre la fila de Organization) — a diferencia de M3, tomado
// incondicionalmente en el 100% de las llamadas: a diferencia de
// updateUser/deleteUser (que tienen una sub-rama barata que nunca puede
// violar el invariante y por eso no necesita lock), deletePipeline no
// tiene un camino "inofensivo" — cualquier borrado es, por definición, un
// intento de reducir el conteo de pipelines activos, así que el chequeo
// (y por lo tanto el lock que lo protege) es siempre relevante.
export async function deletePipeline(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que el resto del
  // código (getCompanyById, getUserById, etc.). No es la defensa real: se
  // revalida dentro de la transacción, después del lock.
  await getPipelineById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);

    // ALTO-8 — el lock de la fila del Pipeline, además del de la organización.
    // Son dos invariantes distintos con dos ámbitos distintos: "la organización
    // nunca se queda con cero pipelines" (H-1) se decide sobre un conteo de
    // TODA la organización, y "este pipeline no tiene stages activos" se decide
    // sobre un conteo de ESTE pipeline. El segundo compite con createStage, que
    // toma únicamente el lock de fila; serializar eso con el de organización
    // habría frenado la creación de stages de todos los pipelines del tenant.
    //
    // ORDEN FIJO —organización primero, pipeline después— y es el único camino
    // que toma los dos, así que no hay forma de que dos transacciones los tomen
    // en orden inverso.
    await lockPipelineForUpdate(id, organizationId, tx);

    // Revalida dentro de la transacción, con el lock ya sostenido: el
    // pre-check de arriba es solo UX rápida, esta lectura es la que
    // realmente decide.
    const pipeline = await findPipelineById(id, organizationId, tx);
    if (!pipeline) {
      throw new AppError("Pipeline no encontrado", 404);
    }

    const activeCount = await countActivePipelines(organizationId, tx);
    if (activeCount <= 1) {
      throw new AppError("No se puede eliminar el último pipeline de la organización", 400);
    }

    // ALTO-8, escenario 2 — RESTRICT lógico: un Pipeline con Stages vivos no se
    // borra. Sin esto, findManyStages devolvía los stages huérfanos en el
    // listado de la organización cuando no venía filters.pipelineId.
    //
    // VA DESPUÉS del chequeo del último pipeline, no antes, y el orden importa:
    // una organización recién onboardeada tiene un solo pipeline Y stages
    // adentro, así que invertirlo cambiaría el error de "no se puede eliminar
    // el último pipeline" por "tiene etapas activas" en el caso más común.
    const stagesActivos = await countActiveStagesByPipeline(id, organizationId, tx);
    if (stagesActivos > 0) {
      throw new AppError(
        "No se puede eliminar un pipeline que tiene etapas activas. Eliminá primero sus etapas.",
        400,
      );
    }

    if (!pipeline.isDefault) {
      const result = await softDeletePipeline(id, organizationId, tx);
      if (result.count === 0) {
        throw new AppError("Pipeline no encontrado", 404);
      }
      return;
    }

    // Este pipeline era el default: promover el más antiguo de los que
    // quedan, para que la organización nunca se quede sin uno, en la misma
    // transacción que el borrado (y ahora también en el mismo lock). Orden
    // importa: primero el soft delete (que saca a este pipeline del
    // alcance del índice único parcial, ya que excluye deleted_at IS NOT
    // NULL), recién después marcar el nuevo default — si lo hiciéramos al
    // revés, habría un instante con dos filas `is_default = true`
    // simultáneas y la constraint lo rechazaría.
    const result = await softDeletePipeline(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Pipeline no encontrado", 404);
    }

    const nextDefault = await findOldestActivePipeline(organizationId, id, tx);
    if (nextDefault) {
      const promoted = await updatePipelineRepo(
        nextDefault.id,
        organizationId,
        { isDefault: true },
        tx,
      );
      if (promoted.count === 0) {
        throw new AppError("Pipeline no encontrado", 404);
      }
    }
  });
}
