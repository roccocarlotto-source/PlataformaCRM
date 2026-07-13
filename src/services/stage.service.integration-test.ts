import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { updateStage } from "./stage.service";

// Test de integración de T-2 (auditoría nueva): stages_won_lost_exclusive_check
// puede violarse porque findStageWithFlag (el pre-check de updateStage) solo
// busca la marca isWon/isLost en OTRAS filas del pipeline — nunca revisa el
// propio flag opuesto de la fila que se está actualizando.
//
// A diferencia de T-1 (que exige una carrera real, dos lecturas antes de
// cualquier commit, y por eso necesita una barrera explícita contra el lock
// real de Postgres para no confundirse con el pre-check síncrono), acá no
// hace falta ningún tipo de concurrencia ni de lock: con el código actual,
// las dos llamadas secuenciales alcanzan el camino del CHECK porque
// findStageWithFlag(pipelineId, "isLost", id) excluye explícitamente la
// propia fila id de su búsqueda y no consulta su flag isWon ya persistido
// — no es una garantía absoluta independiente de cómo se implemente
// findStageWithFlag en el futuro, es una consecuencia directa de cómo está
// escrita hoy. Por eso alcanza con que la primera llamada complete del
// todo y comitee antes de que arranque la segunda: es el test mínimo que
// demuestra la traducción del CHECK sin la fragilidad de sincronizar dos
// operaciones en paralelo.

async function createTestOrgAndPipeline() {
  const org = await prisma.organization.create({
    data: { name: `T2 org ${randomUUID()}`, slug: `t2-org-${Date.now()}` },
  });
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: org.id, name: `T2 Pipeline ${randomUUID()}` },
  });
  return { org, pipeline };
}

interface Fixture {
  orgId: string;
  pipelineId: string;
}

let fx: Fixture;

before(async () => {
  const { org, pipeline } = await createTestOrgAndPipeline();
  fx = { orgId: org.id, pipelineId: pipeline.id };
});

after(async () => {
  if (!fx) return;
  await prisma.stage.deleteMany({ where: { pipelineId: fx.pipelineId } });
  await prisma.pipeline.delete({ where: { id: fx.pipelineId } });
  await prisma.organization.delete({ where: { id: fx.orgId } });
});

test("updateStage: marcar isWon y, ya comiteado, marcar isLost sobre la misma etapa nunca la deja ganada y perdida a la vez, y la segunda operación recibe AppError(409) traducido del CHECK, no un error crudo", async () => {
  const stage = await prisma.stage.create({
    data: {
      organizationId: fx.orgId,
      pipelineId: fx.pipelineId,
      name: `T2 stage ${randomUUID()}`,
      order: 1,
      isWon: false,
      isLost: false,
    },
  });

  // Primera operación: se completa y comitea del todo antes de que la
  // segunda arranque — sin ninguna carrera involucrada.
  const won = await updateStage(fx.orgId, stage.id, { isWon: true });
  assert.equal(won.isWon, true);

  // Segunda operación, estrictamente después de que la primera ya
  // comiteó: findStageWithFlag(pipelineId, "isLost", id) solo revisa
  // OTRAS filas del pipeline — nunca el propio isWon, ya persistido, de
  // esta misma fila — así que pasa sin más, y la escritura real es la que
  // choca contra stages_won_lost_exclusive_check.
  let caught: unknown;
  try {
    await updateStage(fx.orgId, stage.id, { isLost: true });
    assert.fail("updateStage debía rechazar — la etapa quedaría ganada y perdida a la vez");
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof AppError, "debe ser AppError, no un error crudo de Prisma");
  assert.equal((caught as AppError).statusCode, 409);
  assert.equal(
    (caught as AppError).message,
    "Esta etapa no puede quedar marcada como ganada y perdida a la vez",
  );

  const raw = await prisma.stage.findUnique({ where: { id: stage.id } });
  assert.ok(raw, "la fila debe seguir existiendo");
  assert.equal(
    raw!.isWon && raw!.isLost,
    false,
    "el dato persistido nunca debe quedar con isWon e isLost en true a la vez",
  );
});
