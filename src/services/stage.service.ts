import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { countActiveOpportunitiesByStage } from "../repositories/opportunity.repository";
import { findPipelineById, lockPipelineForUpdate } from "../repositories/pipeline.repository";
import {
  countStages,
  countStagesByName,
  createStage as createStageRepo,
  findManyStages,
  findStageById,
  findStagesByPipeline,
  findStageWithFlag,
  lockStageForUpdate,
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

// `db` explícito para poder revalidar DENTRO de la transacción de createStage,
// con el lock del pipeline ya sostenido: el default (`prisma`) es el pre-check
// rápido de afuera, que es UX y no la defensa. Ver createStage.
async function validatePipelineId(organizationId: string, pipelineId: string, db: Db = prisma) {
  const pipeline = await findPipelineById(pipelineId, organizationId, db);
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

  const existingByName = await countStagesByName(input.pipelineId, organizationId, input.name);
  if (existingByName > 0) {
    throw new AppError("Ya existe una etapa con ese nombre en este pipeline", 409);
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(input.pipelineId, organizationId, "isWon");
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como ganada en este pipeline", 409);
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(input.pipelineId, organizationId, "isLost");
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como perdida en este pipeline", 409);
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // ALTO-8 — la otra mitad del RESTRICT de deletePipeline. El bloqueo del
      // borrado decide sobre un conteo de stages activos, y sin lock ese conteo
      // se queda viejo entre que se lee y que se escribe: dos requests
      // concurrentes —uno creando un Stage acá, otro borrando el Pipeline—
      // pueden pasar los dos su chequeo y dejar un Stage activo colgando de un
      // Pipeline borrado. Es el escenario 2 del hallazgo entrando por la puerta
      // de atrás, y la misma clase de bug que H-1.
      await lockPipelineForUpdate(input.pipelineId, organizationId, tx);

      // Revalida con el lock sostenido. El validatePipelineId de más arriba es
      // un 400 rápido para el caso común; ESTA lectura es la que decide, porque
      // es la única que no puede quedar obsoleta entre leer y escribir.
      await validatePipelineId(organizationId, input.pipelineId, tx);

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
    const existingByName = await countStagesByName(
      stage.pipelineId,
      organizationId,
      input.name,
      id,
    );
    if (existingByName > 0) {
      throw new AppError("Ya existe una etapa con ese nombre en este pipeline", 409);
    }
  }

  if (input.isWon) {
    const existing = await findStageWithFlag(stage.pipelineId, organizationId, "isWon", id);
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como ganada en este pipeline", 409);
    }
  }

  if (input.isLost) {
    const existing = await findStageWithFlag(stage.pipelineId, organizationId, "isLost", id);
    if (existing) {
      throw new AppError("Ya existe una etapa marcada como perdida en este pipeline", 409);
    }
  }

  const { order: requestedOrder, ...rest } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      // A-1 (auditoría 2026-08-29) — el cierre de ALTO-5. El reindexado de
      // `order` es una decisión sobre la lista COMPLETA de hermanos, y las tres
      // operaciones que la mantienen (createStage, updateStage, deleteStage)
      // tienen que serializar sobre la misma fila: la del pipeline. Sin este
      // lock, dos reordenamientos concurrentes leían la misma lista y el
      // primero se perdía en silencio (reindexStages reasigna 1..N a todos,
      // así que ni siquiera había violación de constraint que lo delatara); un
      // reorden contra createStage podía terminar en deadlock (500) o en un
      // 409 espurio contra el índice único; y un reorden contra deleteStage
      // leía una foto pre-borrado y le asignaba un slot a la etapa borrada.
      //
      // PRIMERA sentencia y ANTES de cualquier lectura, en el mismo orden que
      // createStage (pipeline, y recién después cualquier fila de stage): así
      // no hay dos caminos que tomen los locks al revés.
      //
      // El pipelineId sale del pre-check de afuera y eso es correcto: un stage
      // nunca cambia de pipeline vía la API, así que ese dato no puede quedar
      // viejo. `order` sí puede, y por eso se relee abajo.
      await lockPipelineForUpdate(stage.pipelineId, organizationId, tx);

      // Relee con el lock sostenido. El `stage` del pre-check es UX (404
      // rápido); su `order` puede haber cambiado por un reindexado ajeno que
      // commiteó entre aquella lectura y este punto, y comparar contra un
      // valor viejo haría un reorden de más (o de menos).
      const actual = await findStageById(id, organizationId, tx);
      if (!actual) {
        throw new AppError("Etapa no encontrada", 404);
      }

      if (requestedOrder !== undefined && requestedOrder !== actual.order) {
        // Con el lock del pipeline sostenido, esta lectura no puede ser una
        // foto vieja: cualquier borrado o alta concurrente ya commiteó (y
        // findStagesByPipeline excluye los borrados) o todavía no empezó.
        const siblings = await findStagesByPipeline(actual.pipelineId, tx);
        const finalOrderIds = computeFinalOrderIds(siblings, id, requestedOrder);

        await reindexStages(actual.pipelineId, finalOrderIds, tx);
      }

      // SOLO si hay algo que escribir además del orden. Bug preexistente que
      // destapó el test de concurrencia de A-1: con un PATCH que trae solo
      // `order` (el de un drag & drop), `rest` es `{}` y Prisma resuelve
      // `updateMany({ data: {} })` como `{ count: 0 }` sin ejecutar nada — ni
      // siquiera toca `updatedAt`, que solo se bumpea cuando hay cambios. Ese
      // 0 se leía como "no existe": el reorden respondía 404 y la transacción
      // revertía el reindexado ya hecho. La existencia de la etapa ya la
      // decidió la relectura de arriba, con el lock sostenido; acá el count
      // solo tiene sentido cuando hubo un UPDATE real.
      const hayCamposParaEscribir = Object.values(rest).some((valor) => valor !== undefined);
      if (hayCamposParaEscribir) {
        const result = await updateStageRepo(id, organizationId, rest, tx);
        if (result.count === 0) {
          throw new AppError("Etapa no encontrada", 404);
        }
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

// ALTO-8, escenario 1 — RESTRICT lógico: borrar un Stage con oportunidades
// vivas no está permitido.
//
// Antes deleteStage no consultaba `opportunities` en absoluto. Las
// oportunidades del stage borrado seguían contando en countOpportunities y en
// los totales, pero desaparecían del tablero, que se arma por stages activos:
// los números del pipeline dejaban de cuadrar con las columnas.
//
// BLOQUEO Y NO CASCADA, misma decisión que ya rige para "el último pipeline"
// (deletePipeline) y con el mismo formato de error: AppError con 400. Una
// cascada lógica obligaría a distinguir "borrado por cascada" de "borrado
// propio" para poder restaurar con sentido —un deleteBatchId y todo lo que
// arrastra— y el bloqueo elimina la clase entera de bugs sin agregar estado
// nuevo. Peor UX, sí: el precio es explícito.
//
// La opción de filtrar en lectura por el estado del padre está descartada por
// la auditoría misma (opción C de ALTO-8): mueve la inconsistencia a las
// queries y hay que acordarse en cada una.
export async function deleteStage(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que deletePipeline. Se
  // conserva solo por su pipelineId, que es inmutable (un stage nunca cambia
  // de pipeline vía la API); todo lo demás se relee adentro.
  const preview = await getStageById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    // A-1 (auditoría 2026-08-29) — el lock del PIPELINE, primero. Borrar una
    // etapa cierra un hueco en la numeración (shiftDownAfter), o sea que es
    // una escritura sobre la lista completa de hermanos, igual que createStage
    // y updateStage; los tres tienen que serializar sobre la misma fila.
    // Antes este camino solo tomaba el lock de la propia etapa, así que un
    // reordenamiento concurrente podía leer la lista con esta etapa todavía
    // viva y asignarle un slot después de borrada.
    //
    // ORDEN FIJO: pipeline y DESPUÉS stage, el mismo que createStage. Ningún
    // camino toma un stage antes que su pipeline (createOpportunity y
    // updateOpportunity toman el stage solo), así que no hay abrazo posible.
    await lockPipelineForUpdate(preview.pipelineId, organizationId, tx);

    // Serializa contra createOpportunity / updateOpportunity, que toman este
    // mismo lock (y solo éste). Sin él, el conteo de abajo puede leer 0
    // mientras otra transacción está insertando la oportunidad número 1. El
    // lock del pipeline no lo reemplaza: aquellas dos no lo toman.
    await lockStageForUpdate(id, organizationId, tx);

    // Revalida con el lock sostenido, y además vuelve a leer `order`: el
    // reindexado de otra operación pudo haberlo movido entre el pre-check y
    // este punto, y shiftDownAfter con un `order` viejo cerraría el hueco
    // equivocado.
    const stage = await findStageById(id, organizationId, tx);
    if (!stage) {
      throw new AppError("Etapa no encontrada", 404);
    }

    const oportunidadesActivas = await countActiveOpportunitiesByStage(id, organizationId, tx);
    if (oportunidadesActivas > 0) {
      throw new AppError(
        "No se puede eliminar una etapa que tiene oportunidades activas. Movelas a otra etapa primero.",
        400,
      );
    }

    const result = await softDeleteStage(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Etapa no encontrada", 404);
    }
    await shiftDownAfter(stage.pipelineId, stage.order, tx);
  });
}
