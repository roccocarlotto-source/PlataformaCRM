import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { createPipeline, deletePipeline } from "./pipeline.service";
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
//   - Se mantiene "ambos no-default" igual: ejercita el camino simple
//     (distinto del de promoción de default) bajo contención real; post-fix
//     pasó 5/5 corridas aisladas bajo el mismo protocolo — vale como test
//     de invariante/regresión de ese camino, no se presenta como
//     reproductor confiable del bug en un solo intento aislado. No hay
//     ninguna barrera que fuerce un interleaving concreto (sigue siendo
//     Promise.allSettled tal cual): 5/5 es el resultado observado bajo el
//     protocolo corrido, no una garantía de determinismo del test.
//
// Corregido con el mismo mecanismo que M3 (lockOrganizationForUpdate +
// prisma.$transaction), a diferencia de M3 tomado incondicionalmente en el
// 100% de las llamadas — deletePipeline no tiene una sub-rama barata que
// no pueda violar el invariante, así que no hay optimización válida de
// "solo lockear a veces" acá (ver informe de la corrección).
// ---------------------------------------------------------------------------

test("deletePipeline vs deletePipeline (ambos no-default): nunca deja la organización sin ningún Pipeline activo", async () => {
  const org = await createTestOrg();
  try {
    const p1 = await createPipeline(org.id, { name: "P1" });
    const p2 = await createPipeline(org.id, { name: "P2" });
    if (!p1 || !p2) throw new Error("setup failed");

    const results = await Promise.allSettled([
      deletePipeline(org.id, p1.id),
      deletePipeline(org.id, p2.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(
      fulfilled.length,
      1,
      "exactamente una de las dos operaciones concurrentes debe ganar",
    );
    assert.equal(
      rejected.length,
      1,
      "la otra debe perder, nunca ambas deben tener éxito",
    );

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      loserReason instanceof AppError,
      "la perdedora debe ser un AppError, no un error crudo",
    );
    assert.equal(loserReason.statusCode, 400);
    assert.equal(
      loserReason.message,
      "No se puede eliminar el último pipeline de la organización",
    );

    const remaining = await prisma.pipeline.count({
      where: { organizationId: org.id, deletedAt: null },
    });
    assert.equal(
      remaining,
      1,
      "debe quedar exactamente un Pipeline activo — nunca cero",
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
    assert.equal(
      rejected.length,
      1,
      "la otra debe perder, nunca ambas deben tener éxito",
    );

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      loserReason instanceof AppError,
      "la perdedora debe ser un AppError, no un error crudo",
    );
    assert.equal(loserReason.statusCode, 400);
    assert.equal(
      loserReason.message,
      "No se puede eliminar el último pipeline de la organización",
    );

    const remaining = await prisma.pipeline.findMany({
      where: { organizationId: org.id, deletedAt: null },
    });
    assert.equal(
      remaining.length,
      1,
      "debe quedar exactamente un Pipeline activo — nunca cero",
    );
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
