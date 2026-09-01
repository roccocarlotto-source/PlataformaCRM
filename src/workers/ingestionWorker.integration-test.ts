import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { drenarPendientes } from "./ingestionWorker";

// B-30 (docs/auditoria-2026-08-29.md) — reintentos con backoff y DEAD_LETTER
// para la cola de ingesta, contra Postgres real.
//
// Lo que se prueba acá y no se puede probar sin base: que un error de SISTEMA
// deja el intento CONTABILIZADO en la fila (attempts/next_attempt_at/
// last_error), que el reclamo respeta el próximo turno (el WHERE con coalesce
// de claimNextPendingEvent), el camino a DEAD_LETTER, y que el camino de dato
// inválido (FAILED) sigue exactamente como antes, sin gastar reintentos. La
// aritmética del backoff vive en utils/backoff.ts y ya está probada sin base
// en outbox.service.test.ts (que la reexporta).
//
// EL ERROR DE SISTEMA SE INYECTA CON antesDePromover: corre dentro de la
// transacción del evento, después del reclamo y antes de promover — lanzar ahí
// es indistinguible, para el catch de drenarPendientes, de una constraint
// inesperada o una base que se cae a mitad de la promoción. Es el gancho "SOLO
// PARA TESTS" que ya existía (M-19); no hizo falta otro mecanismo.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN y drena acotado a ella, mismo criterio
// que el resto de la suite: el runner corre los archivos en paralelo contra
// una base compartida.

interface Escenario {
  organizationId: string;
  sourceId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `IngWorker ${etiqueta} ${randomUUID()}`,
      slug: `ingworker-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const source = await prisma.source.create({
    data: { organizationId: org.id, name: `Fuente ${etiqueta}`, type: "WEBHOOK" },
  });
  return { organizationId: org.id, sourceId: source.id };
}

async function desmontar(escenario: Escenario) {
  const where = { organizationId: escenario.organizationId };
  await prisma.ingestionEvent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.source.deleteMany({ where });
  await prisma.organization.delete({ where: { id: escenario.organizationId } });
}

async function crearEvento(escenario: Escenario, rawPayload: unknown): Promise<string> {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: escenario.organizationId,
      sourceId: escenario.sourceId,
      externalId: `b30-${randomUUID()}`,
      rawPayload: rawPayload as never,
    },
    select: { id: true },
  });
  return evento.id;
}

function payloadValido() {
  return {
    firstName: "Ana",
    lastName: "Pérez",
    email: `b30-${randomUUID().slice(0, 8)}@ejemplo.test`,
  };
}

function leer(id: string) {
  return prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      attempts: true,
      nextAttemptAt: true,
      lastError: true,
      errorMessage: true,
    },
  });
}

// Simula que pasó el tiempo del backoff, sin esperarlo — mismo helper que el
// test del worker de outbox: lo que se prueba es la máquina de estados, no el
// reloj.
async function adelantarElReloj(id: string) {
  await prisma.ingestionEvent.update({
    where: { id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

const FALLO = "fallo de sistema inyectado (B-30)";
const explotar = async () => {
  throw new Error(FALLO);
};

test("B-30: un error de sistema deja el intento contabilizado — attempts, próximo turno con backoff y lastError, sin tocar errorMessage", async () => {
  const escenario = await montar("primer-fallo");
  try {
    const id = await crearEvento(escenario, payloadValido());
    const antesDeDrenar = Date.now();

    const resumen = await drenarPendientes({
      organizationId: escenario.organizationId,
      antesDePromover: explotar,
    });

    assert.equal(resumen.pospuestos, 1);
    assert.equal(resumen.muertos, 0);
    assert.equal(resumen.procesados, 0);

    const fila = await leer(id);
    assert.equal(fila.status, "PENDING", "un error de sistema no es FAILED: la fila sigue viva");
    assert.equal(fila.attempts, 1);
    assert.equal(fila.lastError, FALLO);
    assert.equal(
      fila.errorMessage,
      null,
      "errorMessage es del dato inválido, no de este mecanismo",
    );

    // El próximo turno es "ahora + base" (primer fallo: intentosPrevios = 0).
    // Margen generoso hacia arriba para no depender del reloj del CI.
    assert.ok(fila.nextAttemptAt, "tiene que haber próximo turno");
    const espera = fila.nextAttemptAt.getTime() - antesDeDrenar;
    assert.ok(espera > 0, "el turno queda en el futuro");
    assert.ok(
      espera <= env.INGEST_BACKOFF_BASE_MS + 10_000,
      `el primer backoff es la base (~${String(env.INGEST_BACKOFF_BASE_MS)} ms), no más: fue ${String(espera)} ms`,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("B-30: la fila pospuesta no se vuelve a reclamar — ni en la misma pasada ni antes de su turno — y sí cuando le toca", async () => {
  const escenario = await montar("no-antes-de-turno");
  try {
    const idA = await crearEvento(escenario, payloadValido());

    // limite 3 con el fallo inyectado: la pasada reclama A, falla, y NO la
    // vuelve a elegir (excluidos de la pasada + nextAttemptAt en el futuro).
    const primera = await drenarPendientes({
      organizationId: escenario.organizationId,
      limite: 3,
      antesDePromover: explotar,
    });
    assert.equal(primera.pospuestos, 1, "un solo intento en la pasada, no tres");
    assert.equal((await leer(idA)).attempts, 1);

    // Una pasada nueva ANTES del turno de A: procesa al control B y a A ni la
    // mira (el WHERE con coalesce la excluye; no hay lista en memoria entre
    // pasadas que pueda explicar esto).
    const idB = await crearEvento(escenario, payloadValido());
    const segunda = await drenarPendientes({ organizationId: escenario.organizationId });
    assert.equal(segunda.procesados, 1, "el control B sí se promueve");
    assert.equal(segunda.pospuestos, 0);
    const filaA = await leer(idA);
    assert.equal(filaA.status, "PENDING");
    assert.equal(filaA.attempts, 1, "A no consumió ningún intento antes de su turno");
    assert.equal((await leer(idB)).status, "PROCESSED");

    // Cuando el turno llega (reloj adelantado, no esperado), A vuelve a ser
    // reclamable y consume su segundo intento.
    await adelantarElReloj(idA);
    const tercera = await drenarPendientes({
      organizationId: escenario.organizationId,
      antesDePromover: explotar,
    });
    assert.equal(tercera.pospuestos, 1);
    assert.equal((await leer(idA)).attempts, 2);
  } finally {
    await desmontar(escenario);
  }
});

test("B-30: al agotar INGEST_MAX_ATTEMPTS pasa a DEAD_LETTER, y nadie la reclama nunca más", async () => {
  const escenario = await montar("dead-letter");
  try {
    const id = await crearEvento(escenario, payloadValido());
    let muertosVistos = 0;

    // Se adelanta el reloj entre pasadas en vez de esperar el backoff real —
    // mismo patrón que el test de DEAD_LETTER del worker de outbox.
    for (let i = 0; i < env.INGEST_MAX_ATTEMPTS; i++) {
      const resumen = await drenarPendientes({
        organizationId: escenario.organizationId,
        antesDePromover: explotar,
      });
      muertosVistos += resumen.muertos;
      const parcial = await leer(id);
      if (parcial.status === "PENDING") {
        await adelantarElReloj(id);
      }
    }

    const fila = await leer(id);
    assert.equal(fila.status, "DEAD_LETTER");
    assert.equal(fila.attempts, env.INGEST_MAX_ATTEMPTS);
    assert.equal(fila.lastError, FALLO);
    assert.equal(fila.nextAttemptAt, null, "un DEAD_LETTER no tiene próximo turno");
    assert.equal(muertosVistos, 1, "la pasada que lo mata lo cuenta en resumen.muertos");

    // Terminal de verdad: otra pasada completa ni lo toca (el hook contaría).
    let invocaciones = 0;
    const despues = await drenarPendientes({
      organizationId: escenario.organizationId,
      antesDePromover: async () => {
        invocaciones++;
        throw new Error(FALLO);
      },
    });
    assert.equal(despues.procesados + despues.fallidos + despues.pospuestos + despues.muertos, 0);
    assert.equal(invocaciones, 0, "un DEAD_LETTER no se reclama");
  } finally {
    await desmontar(escenario);
  }
});

test("B-30: control — un payload inválido sigue yendo a FAILED en el primer intento, sin gastar reintentos ni backoff", async () => {
  const escenario = await montar("control-failed");
  try {
    // No es un objeto: promoverEvento lo resuelve internamente como fila mala
    // (FAILED), sin lanzar — el mecanismo de B-30 es SOLO para el catch de
    // error de sistema y no reemplaza nada de ese camino.
    const id = await crearEvento(escenario, "esto no es un objeto");

    const resumen = await drenarPendientes({ organizationId: escenario.organizationId });

    assert.equal(resumen.fallidos, 1);
    assert.equal(resumen.pospuestos, 0);
    assert.equal(resumen.muertos, 0);

    const fila = await leer(id);
    assert.equal(fila.status, "FAILED");
    assert.equal(fila.attempts, 0, "un dato inválido no consume reintentos");
    assert.equal(fila.nextAttemptAt, null);
    assert.equal(fila.lastError, null);
    assert.ok(fila.errorMessage, "el motivo del dato inválido sigue en errorMessage, como siempre");
  } finally {
    await desmontar(escenario);
  }
});
