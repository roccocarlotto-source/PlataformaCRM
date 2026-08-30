import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  FILAS_POR_TANDA,
  IMPORT_BATCH_TRANSACTION_TIMEOUT_MS,
  insertPendingEventsBatch,
  type FilaDeLote,
} from "./ingestionEvent.repository";

// ---------------------------------------------------------------------------
// Atomicidad entre tandas de insertPendingEventsBatch (M-17 de
// docs/auditoria-2026-08-29.md) contra Postgres real.
//
// SE LLAMA AL REPOSITORIO DIRECTAMENTE, no por HTTP: es una prueba de la
// escritura, no del endpoint — mismo criterio que pipeline.service y que
// ingestionEvent-purge. Y LE PREGUNTA A LA BASE: cada afirmación sobre qué
// quedó se cuenta en `ingestion_events` por batchId, nunca se infiere de lo
// que devolvió (o no devolvió) la función.
//
// CÓMO SE HACE FALLAR UNA TANDA A PROPÓSITO, Y POR QUÉ ASÍ. El escenario real
// del hallazgo es un corte de conexión a mitad de tanda, que no se puede
// reproducir de forma determinística sin mockear la conexión — y el proyecto
// ya decidió no tener tests que pasen por timing (M-19). En su lugar se usa
// una falla que Postgres produce SIEMPRE, en la sentencia misma:
// `external_id` es VarChar(255) en el schema y el tipo de TypeScript
// (`FilaDeLote.externalId: string`) no lo acota, así que un externalId de más
// de 255 caracteres hace que el INSERT de esa tanda sea rechazado por la base.
// Es una falla determinística en el mismo punto donde fallaría la conexión:
// dentro del `await $queryRaw` de una tanda posterior a la primera.
// ---------------------------------------------------------------------------

let orgId: string;
let sourceId: string;

function filasValidas(cantidad: number, marca: string): FilaDeLote[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    externalId: `${marca}-${i + 1}`,
    rawPayload: { fila: i + 1, email: `lead-${i + 1}@ejemplo.test` },
  }));
}

function eventosDelLote(batchId: string) {
  return prisma.ingestionEvent.count({ where: { organizationId: orgId, batchId } });
}

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Batch test org ${randomUUID()}`,
      slug: `batch-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  const source = await prisma.source.create({
    data: { organizationId: orgId, name: "Archivo de prueba", type: "FILE_IMPORT" },
    select: { id: true },
  });
  sourceId = source.id;
});

after(async () => {
  if (!orgId) return;
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.source.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

// ---------------------------------------------------------------------------
// El test central: la tanda 2 falla, la tanda 1 no queda.
// ---------------------------------------------------------------------------

test("si una tanda posterior falla, NINGUNA tanda anterior queda commiteada (M-17)", async () => {
  const batchId = randomUUID();
  const marca = `atomico-${randomUUID()}`;

  // FILAS_POR_TANDA + 1: la tanda 1 son las primeras FILAS_POR_TANDA filas,
  // todas válidas; la tanda 2 es la última fila sola, la que Postgres rechaza.
  const filas = filasValidas(FILAS_POR_TANDA + 1, marca);
  filas[filas.length - 1] = {
    externalId: `${marca}-${"x".repeat(300)}`,
    rawPayload: { fila: FILAS_POR_TANDA + 1 },
  };

  // No se exige AppError: una falla de infraestructura durante el INSERT es
  // un 500 antes y después del fix. Lo que cambia es lo que queda en la base.
  await assert.rejects(
    insertPendingEventsBatch({ organizationId: orgId, sourceId, batchId, filas }),
    (err: unknown) =>
      err instanceof Error && /value too long for type character varying\(255\)/.test(err.message),
    "la tanda 2 tiene que fallar por el VarChar(255) de external_id, no por otra cosa",
  );

  // LA AFIRMACIÓN QUE IMPORTA. Sin la transacción, acá habría FILAS_POR_TANDA
  // filas: la tanda 1 ya estaba commiteada cuando la 2 reventó.
  assert.equal(await eventosDelLote(batchId), 0);

  // Y por externalId también, por si el batchId no se escribió como se cree.
  assert.equal(
    await prisma.ingestionEvent.count({
      where: { sourceId, externalId: { startsWith: `${marca}-` } },
    }),
    0,
  );
});

// ---------------------------------------------------------------------------
// Controles: el caso feliz no cambió, y el timeout elegido no es arbitrario.
// ---------------------------------------------------------------------------

test("las mismas filas, todas válidas, se insertan completas — envolver en transacción no cambió el caso feliz", async () => {
  const batchId = randomUUID();
  const filas = filasValidas(FILAS_POR_TANDA + 1, `feliz-${randomUUID()}`);

  const resultado = await insertPendingEventsBatch({
    organizationId: orgId,
    sourceId,
    batchId,
    filas,
  });

  assert.equal(resultado.insertados, FILAS_POR_TANDA + 1);
  assert.equal(resultado.duplicados, 0);
  assert.equal(await eventosDelLote(batchId), FILAS_POR_TANDA + 1);
});

test("el mismo archivo dos veces sigue sin duplicar: la segunda vez todo es duplicado y no se asocia al lote nuevo", async () => {
  const filas = filasValidas(FILAS_POR_TANDA + 1, `repetido-${randomUUID()}`);
  const primero = randomUUID();
  const segundo = randomUUID();

  await insertPendingEventsBatch({ organizationId: orgId, sourceId, batchId: primero, filas });
  const resultado = await insertPendingEventsBatch({
    organizationId: orgId,
    sourceId,
    batchId: segundo,
    filas,
  });

  assert.equal(resultado.insertados, 0);
  assert.equal(resultado.duplicados, FILAS_POR_TANDA + 1);
  assert.equal(await eventosDelLote(primero), FILAS_POR_TANDA + 1);
  assert.equal(await eventosDelLote(segundo), 0);
});

// Deja registrado que IMPORT_BATCH_TRANSACTION_TIMEOUT_MS sale de una medida y
// no del aire. No es un test de performance —no falla por lento salvo que algo
// esté MUY mal—: es la evidencia de que el número tiene el margen que su
// comentario afirma. Al escribirlo, contra una base remota, 3 tandas tardaron
// ~580 ms (~190 ms/tanda) y las 20 del peor caso, 3,2 s.
test("varias tandas completas tardan mucho menos que el timeout de la transacción", async () => {
  const batchId = randomUUID();
  const tandas = 3;
  const filas = filasValidas(FILAS_POR_TANDA * tandas, `tiempo-${randomUUID()}`);

  const inicio = performance.now();
  const resultado = await insertPendingEventsBatch({
    organizationId: orgId,
    sourceId,
    batchId,
    filas,
  });
  const duracionMs = performance.now() - inicio;

  assert.equal(resultado.insertados, FILAS_POR_TANDA * tandas);
  assert.equal(await eventosDelLote(batchId), FILAS_POR_TANDA * tandas);

  // Extrapolado al peor caso legítimo (20 tandas) tiene que seguir entrando
  // con margen: menos de un cuarto del timeout (15 s con el valor actual,
  // contra los ~3-4 s medidos). Si esto falla, el número del timeout hay que
  // repensarlo con una medida nueva, no subirlo a ciegas.
  const tandasEnElPeorCaso = 20;
  const peorCasoEstimadoMs = (duracionMs / tandas) * tandasEnElPeorCaso;
  assert.ok(
    peorCasoEstimadoMs < IMPORT_BATCH_TRANSACTION_TIMEOUT_MS / 4,
    `${tandas} tandas tardaron ${duracionMs.toFixed(0)} ms; extrapolado a ${tandasEnElPeorCaso} tandas son ${peorCasoEstimadoMs.toFixed(0)} ms, que debería ser menos de un cuarto de ${IMPORT_BATCH_TRANSACTION_TIMEOUT_MS} ms`,
  );
});
