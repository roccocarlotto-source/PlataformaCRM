import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  softDeletePipeline,
  updatePipeline as updatePipelineRepo,
} from "../repositories/pipeline.repository";
import { createPipeline, deletePipeline, updatePipeline } from "./pipeline.service";
import { AppError } from "../utils/AppError";

// Test de integración: ejercita pipeline.service + pipeline.repository +
// Prisma reales contra la base de `.env` (Supabase real, ver README). No
// levanta Express — el comportamiento a proteger vive en el service, no en
// el transporte HTTP. Requiere DATABASE_URL/DIRECT_URL alcanzables; corre
// aparte de la suite unitaria de H1 vía `npm run test:integration`
// (ver package.json) para que `npm test` siga sin depender de la base real.
//
// H2: una violación de unicidad de Pipeline (nombre duplicado en la misma
// organización) debía llegar como PrismaClientKnownRequestError(P2002)
// crudo hasta errorHandler y responder 500. Este test provoca esa
// violación real en Postgres — no un P2002 fabricado a mano — y verifica
// que el resultado observable del service sea AppError 409, nunca el
// error crudo de Prisma. Ver nota al final del archivo sobre por qué la
// segunda constraint de Pipeline (el índice parcial de `isDefault`) no
// tiene cobertura persistente en este ciclo.

async function createTestOrg() {
  return prisma.organization.create({
    data: {
      name: `H2 integration test ${randomUUID()}`,
      slug: `h2-integration-test-${randomUUID()}`,
    },
  });
}

async function deleteTestOrg(organizationId: string) {
  await prisma.pipeline.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
}

test("createPipeline traduce la violación real del nombre duplicado a 409, no a P2002 crudo", async () => {
  const org = await createTestOrg();
  try {
    await createPipeline(org.id, { name: "Ventas" });

    await assert.rejects(
      () => createPipeline(org.id, { name: "Ventas" }),
      (err: unknown) => {
        assert.ok(err instanceof AppError, "debe ser AppError, no el P2002 crudo de Prisma");
        assert.equal((err as AppError).statusCode, 409);
        return true;
      },
    );
  } finally {
    await deleteTestOrg(org.id);
  }
});

// NOTA — cobertura NO agregada para la segunda constraint (índice parcial
// `pipelines_org_default_unique`, a lo sumo un default por organización):
// se intentó reproducirla con dos createPipeline({isDefault:true}) lanzados
// vía Promise.allSettled y, de forma reproducible (no flaky), las dos
// transacciones se serializaron sin solapar — createPipeline siempre
// desmarca el default anterior ANTES de insertar el nuevo, así que salvo
// que dos transacciones estén realmente abiertas y solapadas al mismo
// tiempo, esa lógica se auto-corrige y nunca llega a chocar contra el
// índice. Forzar el solapamiento de forma determinística requeriría
// inyectar un punto de sincronización artificial dentro de
// pipeline.service.ts (p. ej. una función que acepte un hook de test para
// pausar entre el unset y el insert) — un cambio de producción solo para
// hacer testeable una carrera, fuera del alcance de la corrección mínima
// de H2. La traducción P2002 → 409 para esta constraint corre por el mismo
// `rethrowAsConflict` ya cubierto arriba (mismo código, otra rama del
// mismo `if`), y se verificó manualmente contra la base real que
// `err.meta.target` para esta constraint es `["organization_id"]` (ver
// informe de la corrección). Riesgo residual documentado, no cubierto por
// un test persistente en este ciclo.

// ---------------------------------------------------------------------------
// H-1 (auditoría nueva, no H2): deletePipeline hacía check-then-act sin
// ningún lock — dos deletePipeline concurrentes sobre dos Pipelines
// distintos de la misma organización podían leer el mismo
// countActivePipelines antes de que cualquiera de las dos commiteara, y
// ambas proceder, dejando la organización con 0 Pipelines activos. A
// diferencia de la nota de arriba (H2, índice de unicidad de `isDefault`,
// se autoserializa y no hace falta forzar nada), acá SÍ hace falta una
// carrera real con Promise.allSettled: el invariante roto ("al menos 1
// activo") no tiene backing de ninguna constraint de Postgres, así que sin
// la carrera real no hay forma de que el bug se manifieste.
//
// Trazabilidad de la evidencia — separada a propósito, para no atribuirle
// a estos dos tests una tasa que no midieron ellos mismos:
//   - La tasa 24/25 (y, en una reverificación, 19/20) viene de un
//     diagnóstico TEMPORAL, no persistido, corrido en loop dentro de un
//     mismo proceso ya "tibio" (muchas iteraciones seguidas) — no de estos
//     tests tal como quedan en el repo.
//   - Capacidad de detección real de CADA test, verificada antes del fix,
//     cada uno como una corrida aislada de proceso nuevo (`npx tsx --test`,
//     el modo en que realmente corren vía `npm run test:integration`):
//     "uno default, otro no" detectó el bug de forma confiable, 4/4
//     corridas aisladas — su ventana de carrera es más ancha (el camino
//     default usaba una transacción explícita de varios statements).
//     "ambos no-default" NO detectó el bug en ninguna de 4 corridas
//     aisladas (0/4) — ventana de carrera angosta (camino simple, sin
//     transacción explícita en el código pre-fix), así que un único
//     intento en un proceso recién arrancado tiene baja probabilidad real
//     de mostrarlo, aunque el mismo código, en un proceso tibio con
//     muchas iteraciones, sí lo reproducía la enorme mayoría de las veces
//     (evidencia del diagnóstico temporal, arriba).
//   - "ambos no-default" quedó así hasta M-19 (docs/auditoria-2026-08-29.md):
//     0/4 de detección aislada era un test secuencial disfrazado de carrera.
//     Desde M-19 fuerza el interleaving peligroso con la técnica de
//     src/lib/carreras.test-helper.ts: una transacción A toma el MISMO
//     lockOrganizationForUpdate que toma deletePipeline y aplica el efecto
//     del rival (soft delete de p2) sin commitear; el deletePipeline real de
//     p1 tiene que bloquearse en ese lock —Postgres lo confirma vía
//     pg_blocking_pids— y, al releer, encontrar que p1 es el último. Sin el
//     lock, B no se bloquea y el helper lo reporta como fallo determinista.
//     "uno default, otro no" sigue con Promise.allSettled: su ventana ancha
//     lo detectaba 4/4 y además afirma la promoción del default remanente,
//     que la técnica de A/B no ejercita.
//
// Corregido con el mismo mecanismo que M3 (lockOrganizationForUpdate +
// prisma.$transaction), a diferencia de M3 tomado incondicionalmente en el
// 100% de las llamadas — deletePipeline no tiene una sub-rama barata que
// no pueda violar el invariante, así que no hay optimización válida de
// "solo lockear a veces" acá (ver informe de la corrección).
// ---------------------------------------------------------------------------

test("deletePipeline vs deletePipeline (ambos no-default): el segundo se bloquea en el lock de la organización y, al releer, nunca deja la organización sin ningún Pipeline activo", async () => {
  const org = await createTestOrg();
  try {
    const p1 = await createPipeline(org.id, { name: "P1" });
    const p2 = await createPipeline(org.id, { name: "P2" });
    if (!p1 || !p2) throw new Error("setup failed");
    // Que ninguno sea default: el camino simple es el que M-19 señala.
    await prisma.pipeline.updateMany({
      where: { organizationId: org.id },
      data: { isDefault: false },
    });

    // A: el deletePipeline rival de p2 — mismo lock real, mismo efecto (soft
    // delete), sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockOrganizationForUpdate(org.id, tx);
      await tx.pipeline.update({ where: { id: p2.id }, data: { deletedAt: new Date() } });
    });

    // B: el deletePipeline real de p1. Su pre-check ve dos pipelines activos
    // (A no commiteó); su transacción tiene que bloquearse en el lock.
    const b = deletePipeline(org.id, p1.id);
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, "deletePipeline(p1)");

    a.liberar();
    await a.terminada;

    const resultado = await b.then(
      () => undefined,
      (err: unknown) => err,
    );
    assert.ok(
      resultado instanceof AppError,
      `deletePipeline(p1) debía rechazar tras releer; resultado: ${String(resultado)}`,
    );
    assert.equal(resultado.statusCode, 400);
    assert.equal(resultado.message, "No se puede eliminar el último pipeline de la organización");

    const activos = await prisma.pipeline.findMany({
      where: { organizationId: org.id, deletedAt: null },
      select: { id: true },
    });
    assert.deepEqual(
      activos.map((p) => p.id),
      [p1.id],
      "debe quedar exactamente un Pipeline activo, p1 — nunca cero",
    );
  } finally {
    await deleteTestOrg(org.id);
  }
});

test("deletePipeline vs deletePipeline (uno default, otro no): nunca deja la organización sin ningún Pipeline activo, y el remanente queda como default", async () => {
  const org = await createTestOrg();
  try {
    const a = await createPipeline(org.id, { name: "A", isDefault: true });
    const b = await createPipeline(org.id, { name: "B" });
    if (!a || !b) throw new Error("setup failed");

    const results = await Promise.allSettled([
      deletePipeline(org.id, a.id),
      deletePipeline(org.id, b.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(
      fulfilled.length,
      1,
      "exactamente una de las dos operaciones concurrentes debe ganar",
    );
    assert.equal(rejected.length, 1, "la otra debe perder, nunca ambas deben tener éxito");

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      loserReason instanceof AppError,
      "la perdedora debe ser un AppError, no un error crudo",
    );
    assert.equal(loserReason.statusCode, 400);
    assert.equal(loserReason.message, "No se puede eliminar el último pipeline de la organización");

    const remaining = await prisma.pipeline.findMany({
      where: { organizationId: org.id, deletedAt: null },
    });
    assert.equal(remaining.length, 1, "debe quedar exactamente un Pipeline activo — nunca cero");
    assert.equal(
      remaining[0].isDefault,
      true,
      "el único Pipeline activo remanente debe quedar marcado como default",
    );
  } finally {
    await deleteTestOrg(org.id);
  }
});

// ---------------------------------------------------------------------------
// PIPE-DEFAULT-GHOST (auditoría nueva, surgida durante la investigación de
// H-1, deliberadamente no plegada en su alcance): softDeletePipeline
// escribía únicamente deletedAt — nunca isDefault. Si el pipeline borrado
// era el default, la fila queda soft-deleted con isDefault: true para
// siempre, porque ninguna escritura posterior puede volver a alcanzarla:
// unsetDefaultPipeline filtra deletedAt: null en su propio WHERE, así que
// nunca la toca. 100% determinístico, sin concurrencia — a diferencia de
// H-1, no hace falta ninguna carrera para reproducirlo.
//
// Distinción de impacto (no confundir con "sin impacto" — ver informe de la
// investigación): las queries activas (deletedAt: null) y el índice único
// parcial pipelines_org_default_unique (que excluye deleted_at IS NOT NULL
// por diseño) hacen que esto no tenga efecto funcional observable hoy vía
// la API — pero la inconsistencia en el dato raw es real y se acumula, una
// fila más por cada default borrado. Este test lee la fila RAW, sin filtrar
// deletedAt, precisamente porque ese es el único punto donde el bug es
// observable — las queries activas lo esconden por construcción.
// ---------------------------------------------------------------------------

test("deletePipeline (target era default): la fila soft-deleted queda con isDefault=false, no fantasma", async () => {
  const org = await createTestOrg();
  try {
    const a = await createPipeline(org.id, { name: "A", isDefault: true });
    const b = await createPipeline(org.id, { name: "B" });
    if (!a || !b) throw new Error("setup failed");

    await deletePipeline(org.id, a.id);

    // Lectura RAW, sin filtrar deletedAt — el punto exacto que las queries
    // activas ocultan y que dejó pasar el bug original sin detectarse.
    const rawA = await prisma.pipeline.findUnique({ where: { id: a.id } });
    assert.ok(rawA, "la fila debe seguir existiendo (soft delete, no hard delete)");
    assert.notEqual(rawA.deletedAt, null, "debe quedar marcada como borrada");
    assert.equal(
      rawA.isDefault,
      false,
      "una fila soft-deleted nunca debe quedar marcada como default",
    );

    const rawB = await prisma.pipeline.findUnique({ where: { id: b.id } });
    assert.equal(rawB?.deletedAt, null, "B debe seguir activo");
    assert.equal(rawB?.isDefault, true, "B debe quedar promovido a default");
  } finally {
    await deleteTestOrg(org.id);
  }
});

// ---------------------------------------------------------------------------
// M-8 (auditoría 2026-08-29): PATCH {isDefault: false} sobre el pipeline que
// hoy es el default dejaba a la organización sin ninguno. El índice parcial
// pipelines_org_default_unique impide DOS defaults, no CERO, así que ninguna
// constraint lo frenaba; deletePipeline promueve otro justamente para que
// nunca haya cero. Decisión: 400, sin auto-promoción — el que quiere otro
// default lo marca con {isDefault: true}, que ya desmarca a este.
//
// Los dos primeros tests son el enunciado del hallazgo. El tercero es la
// carrera que justifica que el chequeo corra bajo lockOrganizationForUpdate
// y no como un simple check-then-act: el otro camino que MUEVE el default
// —la promoción que hace deletePipeline al borrar el que lo era— corre bajo
// ese mismo lock. Mismo harness que los tests de A-1 en
// stage.service.integration-test.ts (transacción A que toma el lock con la
// misma sentencia que el service, escribe, y se queda abierta; el service
// real arranca contra ella; pg_stat_activity/pg_locks dicen DÓNDE se trabó;
// recién entonces se libera A), solo que el lock es el de `organizations`.
// ---------------------------------------------------------------------------

test("updatePipeline {isDefault: false} sobre el default de la organización: 400 y sigue siendo default en la base", async () => {
  const org = await createTestOrg();
  try {
    const a = await createPipeline(org.id, { name: "A", isDefault: true });
    const b = await createPipeline(org.id, { name: "B" });
    if (!a || !b) throw new Error("setup failed");

    await assert.rejects(
      () => updatePipeline(org.id, a.id, { isDefault: false }),
      (err: unknown) => {
        assert.ok(err instanceof AppError, "debe ser AppError");
        assert.equal((err as AppError).statusCode, 400);
        return true;
      },
    );

    const rawA = await prisma.pipeline.findUnique({ where: { id: a.id } });
    assert.equal(rawA?.isDefault, true, "A tiene que seguir siendo el default");
    assert.equal(rawA?.deletedAt, null);
    const rawB = await prisma.pipeline.findUnique({ where: { id: b.id } });
    assert.equal(rawB?.isDefault, false, "B no tiene que haber sido promovido: sin auto-promoción");

    const defaults = await prisma.pipeline.count({
      where: { organizationId: org.id, isDefault: true, deletedAt: null },
    });
    assert.equal(defaults, 1, "la organización sigue con exactamente un default");
  } finally {
    await deleteTestOrg(org.id);
  }
});

test("updatePipeline {isDefault: false} sobre un pipeline que NO es el default: sigue funcionando (no-op sobre isDefault, el default no se toca)", async () => {
  const org = await createTestOrg();
  try {
    const a = await createPipeline(org.id, { name: "A", isDefault: true });
    const b = await createPipeline(org.id, { name: "B" });
    if (!a || !b) throw new Error("setup failed");

    const updated = await updatePipeline(org.id, b.id, { isDefault: false, name: "B renombrado" });
    assert.ok(updated);
    assert.equal(updated.id, b.id);
    assert.equal(updated.isDefault, false);
    assert.equal(updated.name, "B renombrado", "el resto del PATCH se aplica igual");

    const rawA = await prisma.pipeline.findUnique({ where: { id: a.id } });
    assert.equal(rawA?.isDefault, true, "A sigue siendo el default");
  } finally {
    await deleteTestOrg(org.id);
  }
});

test("updatePipeline {isDefault: false} vs deletePipeline del default concurrentes: el PATCH espera el lock de la ORGANIZACIÓN, relee la promoción y responde 400 — la organización nunca queda sin default", async () => {
  const org = await createTestOrg();
  try {
    const a = await createPipeline(org.id, { name: "A", isDefault: true });
    const b = await createPipeline(org.id, { name: "B" });
    if (!a || !b) throw new Error("setup failed");

    let aPid: number | undefined;

    let signalAHaEscrito: () => void;
    const aHaEscrito = new Promise<void>((resolve) => {
      signalAHaEscrito = resolve;
    });

    let liberarA: () => void;
    const liberacionDeA = new Promise<void>((resolve) => {
      liberarA = resolve;
    });

    // Transacción A: lo que hace deletePipeline sobre el default, con el
    // mismo lock y las mismas escrituras de repositorio, abierta sin
    // commitear hasta que el test la libere.
    const txAPromise = prisma.$transaction(
      async (txA: Prisma.TransactionClient) => {
        const pidRow = await txA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        aPid = pidRow[0].pid;

        await lockOrganizationForUpdate(org.id, txA);
        await softDeletePipeline(a.id, org.id, txA);
        await updatePipelineRepo(b.id, org.id, { isDefault: true }, txA);

        signalAHaEscrito();
        await liberacionDeA;
      },
      { maxWait: 15000, timeout: 15000 },
    );

    await aHaEscrito;
    assert.ok(aPid !== undefined, "debe conocerse el pid de la transacción A");

    // El service real: cuando arranca, B todavía se lee como no-default
    // (A no commiteó). Sin el lock, escribiría `false` encima de la
    // promoción de A y la organización quedaría con cero defaults.
    const servicePromise = updatePipeline(org.id, b.id, { isDefault: false });
    servicePromise.catch(() => {});

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

    const enEspera = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_locks l
      JOIN pg_class c ON c.oid = l.relation
      WHERE l.pid = ${pidBloqueado}::int AND l.locktype = 'tuple'
    `;
    assert.deepEqual(
      enEspera.map((r) => r.relname),
      ["organizations"],
      "updatePipeline tiene que quedar esperando el FOR UPDATE de la organización — antes de leer el pipeline—, no otra cosa",
    );

    liberarA!();
    await txAPromise;

    await assert.rejects(
      () => servicePromise,
      (err: unknown) => {
        assert.ok(err instanceof AppError, "debe ser AppError");
        assert.equal((err as AppError).statusCode, 400);
        return true;
      },
    );

    const rawB = await prisma.pipeline.findUnique({ where: { id: b.id } });
    assert.equal(rawB?.isDefault, true, "B tiene que conservar la promoción que hizo A");
    assert.equal(rawB?.deletedAt, null);

    const defaults = await prisma.pipeline.count({
      where: { organizationId: org.id, isDefault: true, deletedAt: null },
    });
    assert.equal(defaults, 1, "la organización sigue con exactamente un default");
  } finally {
    await deleteTestOrg(org.id);
  }
});
