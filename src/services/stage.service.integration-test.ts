import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { lockPipelineForUpdate } from "../repositories/pipeline.repository";
import { reindexStages, shiftDownAfter, softDeleteStage } from "../repositories/stage.repository";
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
  // Por organización y no por el pipeline del fixture: los tests de carrera
  // de abajo crean pipelines propios dentro de la misma organización.
  await prisma.stage.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: fx.orgId } });
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

// ---------------------------------------------------------------------------
// A-1 (auditoría 2026-08-29) — el cierre de ALTO-5: updateStage y deleteStage
// tienen que serializar sobre la fila del PIPELINE, igual que createStage.
//
// LA TÉCNICA ES LA DE T-1 (activity.service.integration-test.ts), no un
// Promise.allSettled: ese patrón no fuerza ningún interleaving y detectaría la
// falta del lock solo por azar — es exactamente lo que A-7 de la misma
// auditoría señala. Acá una transacción A del test toma el lock del pipeline
// —la misma sentencia que usa lockPipelineForUpdate— y ejecuta las MISMAS
// escrituras de repositorio que haría un deleteStage (o un updateStage) en
// vuelo, y se queda abierta sin commitear hasta que el test la libere. Recién
// entonces se arranca el service real y se confirma, contra pg_stat_activity y
// pg_locks, DÓNDE quedó bloqueado.
//
// Ese "dónde" es la aserción que distingue el código arreglado del anterior,
// y por eso no alcanza con "quedó bloqueado": sin el lock del pipeline, el
// service también se bloqueaba —pero recién en reindexStages, contra el lock
// de FILA de un stage que A ya había escrito, después de haber leído una foto
// vieja de los hermanos—. Con el fix se bloquea ANTES de leer nada, en el
// FOR UPDATE sobre `pipelines`. pg_locks lo dice sin ambigüedad: el backend
// bloqueado sostiene un lock de tipo `tuple` sobre la relación en cuya fila
// está esperando.
//
// Sin Supabase Auth de por medio: alcanza con Postgres, igual que el test de
// arriba.
// ---------------------------------------------------------------------------

async function crearPipelineConEtapas(cantidad: number) {
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: fx.orgId, name: `A1 Pipeline ${randomUUID()}` },
  });

  const etapas = [];
  for (let order = 1; order <= cantidad; order++) {
    etapas.push(
      await prisma.stage.create({
        data: {
          organizationId: fx.orgId,
          pipelineId: pipeline.id,
          name: `S${order} ${randomUUID().slice(0, 8)}`,
          order,
        },
      }),
    );
  }

  return { pipeline, etapas };
}

async function etapasActivasOrdenadas(pipelineId: string) {
  return prisma.stage.findMany({
    where: { pipelineId, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });
}

// Corre `escrituras` dentro de una transacción A que primero toma el lock del
// pipeline y después queda abierta; arranca `operacionDelService` mientras A
// sigue abierta; confirma contra Postgres que el service quedó bloqueado por A
// y devuelve sobre qué relación está esperando; libera A; y devuelve el
// resultado del service.
async function correrContraPipelineBloqueado<T>(
  pipelineId: string,
  escrituras: (txA: Prisma.TransactionClient) => Promise<void>,
  operacionDelService: () => Promise<T>,
): Promise<{ resultado: T; relacionesEnEspera: string[] }> {
  let aPid: number | undefined;

  let signalAHaEscrito: () => void;
  const aHaEscrito = new Promise<void>((resolve) => {
    signalAHaEscrito = resolve;
  });

  let liberarA: () => void;
  const liberacionDeA = new Promise<void>((resolve) => {
    liberarA = resolve;
  });

  // maxWait/timeout generosos: el plazo real lo administra liberacionDeA, no
  // el default de 5 s de $transaction — mismo criterio que T-1.
  const txAPromise = prisma.$transaction(
    async (txA) => {
      const pidRow = await txA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      aPid = pidRow[0].pid;

      await lockPipelineForUpdate(pipelineId, fx.orgId, txA);
      await escrituras(txA);

      signalAHaEscrito();
      await liberacionDeA;
    },
    { maxWait: 15000, timeout: 15000 },
  );

  await aHaEscrito;
  assert.ok(aPid !== undefined, "debe conocerse el pid de la transacción A");

  const servicePromise = operacionDelService();
  // Evita un unhandledRejection mientras el polling mantiene la promesa
  // pendiente; el resultado real se consume más abajo con el await.
  servicePromise.catch(() => {});

  // Confirmo contra Postgres real que hay un backend bloqueado por A, y
  // capturo su pid para preguntarle a pg_locks sobre qué fila espera.
  let pidBloqueado: number | undefined;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (rows.length > 0) {
      pidBloqueado = rows[0].pid;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.ok(
    pidBloqueado !== undefined,
    "no se detectó ningún backend bloqueado por el lock de A dentro del plazo — no se puede afirmar que el service llegó a pedir el lock",
  );

  // Un backend que espera un lock de fila sostiene un lock `tuple` sobre la
  // relación de esa fila (y espera el `transactionid` del que la tiene). Es lo
  // que dice en qué tabla se trabó: `pipelines` con el fix, `stages` sin él.
  const enEspera = await prisma.$queryRaw<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE l.pid = ${pidBloqueado}::int AND l.locktype = 'tuple'
  `;
  const relacionesEnEspera = enEspera.map((r) => r.relname);

  liberarA!();
  await txAPromise;

  const resultado = await servicePromise;
  return { resultado, relacionesEnEspera };
}

// Bug preexistente que destaparon los dos tests de carrera de abajo la primera
// vez que corrieron en CI: un PATCH que trae SOLO `order` (el de un drag &
// drop) dejaba `rest = {}`, y Prisma resuelve `updateMany({ data: {} })` como
// `{ count: 0 }` sin ejecutar nada. Ese 0 se leía como "no existe": el reorden
// respondía 404 y la transacción revertía el reindexado. Ningún test lo cubría.
test("updateStage con SOLO `order` mueve la etapa y devuelve la etapa — no 404 (bug preexistente)", async () => {
  const { pipeline, etapas } = await crearPipelineConEtapas(3);
  const [s1, s2, s3] = etapas;

  const movida = await updateStage(fx.orgId, s3.id, { order: 1 });
  assert.equal(movida.id, s3.id);
  assert.equal(movida.order, 1);

  const activas = await etapasActivasOrdenadas(pipeline.id);
  assert.deepEqual(
    activas.map((s) => s.id),
    [s3.id, s1.id, s2.id],
  );
  assert.deepEqual(
    activas.map((s) => s.order),
    [1, 2, 3],
  );
});

test("updateStage vs deleteStage concurrentes: el reorden espera el lock del PIPELINE (no el de una fila de stage), y la etapa borrada nunca recibe un slot del reindexado", async () => {
  const { pipeline, etapas } = await crearPipelineConEtapas(4);
  const [s1, s2, s3, s4] = etapas;

  // A hace lo que hace deleteStage con el lock tomado: borra S2 y cierra el
  // hueco (S3 -> 2, S4 -> 3). Queda abierta.
  const { resultado, relacionesEnEspera } = await correrContraPipelineBloqueado(
    pipeline.id,
    async (txA) => {
      const borrado = await softDeleteStage(s2.id, fx.orgId, txA);
      assert.equal(borrado.count, 1, "A debe aplicar su propio borrado real");
      await shiftDownAfter(pipeline.id, s2.order, txA);
    },
    // El service real: mover S4 al principio.
    () => updateStage(fx.orgId, s4.id, { order: 1 }),
  );

  assert.deepEqual(
    relacionesEnEspera,
    ["pipelines"],
    "updateStage tiene que quedar esperando el FOR UPDATE del pipeline — antes de leer a los hermanos—, no un lock de fila de stages dentro de reindexStages",
  );

  assert.equal(resultado.order, 1);

  // Estado final: S4, S1, S3 numerados 1..3, sin huecos. Sin el lock, el
  // reorden habría partido de la foto [S1,S2,S3,S4], le habría dado el slot 3
  // a la etapa borrada y dejado a S3 en 4.
  const activas = await etapasActivasOrdenadas(pipeline.id);
  assert.deepEqual(
    activas.map((s) => s.id),
    [s4.id, s1.id, s3.id],
    "el reorden tiene que aplicarse sobre la lista ya sin la etapa borrada",
  );
  assert.deepEqual(
    activas.map((s) => s.order),
    [1, 2, 3],
    "la numeración de las etapas activas tiene que ser 1..N contigua",
  );

  const borrada = await prisma.stage.findUnique({ where: { id: s2.id } });
  assert.notEqual(borrada?.deletedAt, null, "S2 debe seguir borrada");
  assert.equal(
    borrada?.order,
    s2.order,
    "reindexStages no debe haber tocado a la etapa borrada (con el código anterior le asignaba el slot 3)",
  );
});

test("updateStage vs updateStage concurrentes: el segundo reorden espera el lock del PIPELINE y parte de la lista que dejó el primero — no hay lost update", async () => {
  const { pipeline, etapas } = await crearPipelineConEtapas(4);
  const [s1, s2, s3, s4] = etapas;

  // A hace lo que hace updateStage con el lock tomado: mueve S4 al principio
  // ([S4, S1, S2, S3]) y queda abierta sin commitear.
  const { resultado, relacionesEnEspera } = await correrContraPipelineBloqueado(
    pipeline.id,
    async (txA) => {
      await reindexStages(pipeline.id, [s4.id, s1.id, s2.id, s3.id], txA);
    },
    // El service real: mover S3 al principio.
    () => updateStage(fx.orgId, s3.id, { order: 1 }),
  );

  assert.deepEqual(
    relacionesEnEspera,
    ["pipelines"],
    "el segundo updateStage tiene que quedar esperando el FOR UPDATE del pipeline, no un lock de fila de stages",
  );

  assert.equal(resultado.order, 1);

  // Los DOS reordenamientos tienen que verse: S3 primero (el segundo) y S4
  // delante de S1 y S2 (el primero). Sin el lock, el segundo habría leído la
  // lista original [S1,S2,S3,S4] y el resultado sería [S3,S1,S2,S4]: el
  // primer reorden perdido en silencio, sin ninguna constraint que lo delate.
  const activas = await etapasActivasOrdenadas(pipeline.id);
  assert.deepEqual(
    activas.map((s) => s.id),
    [s3.id, s4.id, s1.id, s2.id],
    "el segundo reorden tiene que partir de la lista que dejó el primero",
  );
  assert.deepEqual(
    activas.map((s) => s.order),
    [1, 2, 3, 4],
  );
});
