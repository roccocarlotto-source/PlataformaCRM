import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { claimNextClaimableEvent, emitOutboxEvent } from "../repositories/outboxEvent.repository";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import { drenarOutbox } from "./outboxWorker";

// Motor de eventos salientes — el worker completo contra Postgres real.
//
// Lo que se prueba acá y no se puede probar sin base: el reclamo con
// FOR UPDATE SKIP LOCKED, que el backoff efectivamente posponga la siguiente
// pasada, el camino a DEAD_LETTER, y la atomicidad de la emisión. La aritmética
// del backoff y el registro de handlers viven en outbox.service.test.ts, sin
// red.
//
// CADA TEST TRAE SU PROPIO REGISTRO DE HANDLERS, creado con la factory. No se
// toca el singleton de producción: el runner corre los archivos de integración
// en paralelo y un registro global compartido convertiría estos tests en
// dependientes del orden.
//
// CADA TEST TRAE TAMBIÉN SU PROPIA ORGANIZACIÓN, y drena acotado a ella
// (`organizationId`). Sin eso, dos archivos de integración corriendo a la vez se
// robarían los eventos entre sí — mismo criterio que ya usan los tests de la
// cola de ingesta.

interface Escenario {
  organizationId: string;
  registro: RegistroDeHandlers;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `Outbox ${etiqueta} ${randomUUID()}`,
      slug: `outbox-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return { organizationId: org.id, registro: crearRegistroDeHandlers() };
}

async function desmontar(escenario: Escenario) {
  await prisma.outboxEvent.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.organization.delete({ where: { id: escenario.organizationId } });
}

// Emite un evento en su propia transacción. Producción NUNCA hace esto —el
// evento va dentro de la transacción del cambio de negocio— pero un test que
// solo quiere una fila en la cola no tiene ningún cambio de negocio que
// acompañar.
async function emitir(escenario: Escenario, eventType: string, payload: object = {}) {
  return prisma.$transaction((tx) =>
    emitOutboxEvent({ organizationId: escenario.organizationId, eventType, payload }, tx),
  );
}

function leer(id: string) {
  return prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
}

// Simula que pasó el tiempo del backoff, sin esperarlo. Con la base de 30 s de
// los defaults, un test que esperara de verdad tardaría minutos; lo que importa
// probar es la máquina de estados, no el reloj.
async function adelantarElReloj(id: string) {
  await prisma.outboxEvent.update({
    where: { id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

// ---------------------------------------------------------------------------
// Camino feliz y atomicidad de la emisión
// ---------------------------------------------------------------------------

test("un evento con handler registrado se entrega y queda PROCESSED, con el payload intacto", async () => {
  const escenario = await montar("feliz");
  try {
    const recibidos: unknown[] = [];
    escenario.registro.registrar("test.feliz", async (evento) => {
      recibidos.push(evento.payload);
    });

    const evento = await emitir(escenario, "test.feliz", { contactId: "abc", monto: 42 });

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });

    assert.equal(resumen.entregados, 1);
    assert.deepEqual(recibidos, [{ contactId: "abc", monto: 42 }]);

    const fila = await leer(evento.id);
    assert.equal(fila.status, "PROCESSED");
    assert.equal(fila.lastError, null);
  } finally {
    await desmontar(escenario);
  }
});

test("emitOutboxEvent es atómico con la transacción que lo llama: si esa transacción revierte, NO queda evento", async () => {
  // Es el punto entero del patrón outbox. Sin esta propiedad, un proceso que
  // muere entre el commit del negocio y el envío del aviso pierde el aviso, y
  // no queda rastro de que faltó.
  const escenario = await montar("atomico");
  try {
    class Revertir extends Error {}

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await emitOutboxEvent(
          { organizationId: escenario.organizationId, eventType: "test.atomico", payload: {} },
          tx,
        );
        throw new Revertir();
      }),
      Revertir,
    );

    const cuantos = await prisma.outboxEvent.count({
      where: { organizationId: escenario.organizationId },
    });
    assert.equal(cuantos, 0, "el evento no debe sobrevivir a una transacción revertida");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Exclusión mutua: FOR UPDATE SKIP LOCKED
// ---------------------------------------------------------------------------

test("dos workers no reclaman el mismo evento: el segundo lo saltea en vez de esperarlo", async () => {
  const escenario = await montar("skip-locked");
  try {
    const evento = await emitir(escenario, "test.lock");

    await prisma.$transaction(async (txA) => {
      // A reclama y SOSTIENE el lock hasta el final de su transacción.
      const reclamadoPorA = await claimNextClaimableEvent(txA, {
        organizationId: escenario.organizationId,
      });
      assert.equal(reclamadoPorA?.id, evento.id);

      // B, en otra transacción y mientras A sigue abierta. SKIP LOCKED tiene que
      // hacer que lo SALTEE y devuelva null — no que se quede esperando el lock,
      // que sería el comportamiento sin SKIP LOCKED y convertiría la cola en un
      // cuello de botella con más de un worker.
      const reclamadoPorB = await prisma.$transaction((txB) =>
        claimNextClaimableEvent(txB, { organizationId: escenario.organizationId }),
      );
      assert.equal(reclamadoPorB, null, "el segundo worker no debe poder reclamar el mismo evento");
    });
  } finally {
    await desmontar(escenario);
  }
});

test("con dos eventos, dos workers concurrentes toman uno cada uno — no se pisan ni se bloquean", async () => {
  const escenario = await montar("reparto");
  try {
    await emitir(escenario, "test.reparto", { n: 1 });
    await emitir(escenario, "test.reparto", { n: 2 });

    await prisma.$transaction(async (txA) => {
      const a = await claimNextClaimableEvent(txA, {
        organizationId: escenario.organizationId,
      });
      const b = await prisma.$transaction((txB) =>
        claimNextClaimableEvent(txB, { organizationId: escenario.organizationId }),
      );

      assert.ok(a, "A debía reclamar uno");
      assert.ok(b, "B debía reclamar el otro, no quedarse esperando");
      assert.notEqual(a.id, b.id, "nunca el mismo evento");
    });
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Reintentos y backoff
// ---------------------------------------------------------------------------

test("un handler que falla NO mata el evento: sube attempts, guarda el error y lo reprograma al futuro", async () => {
  const escenario = await montar("backoff");
  try {
    escenario.registro.registrar("test.backoff", async () => {
      throw new Error("el destino respondió 503");
    });

    const evento = await emitir(escenario, "test.backoff");

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });
    assert.equal(resumen.reprogramados, 1);

    const fila = await leer(evento.id);
    assert.equal(fila.status, "PENDING", "un fallo de entrega no es terminal");
    assert.equal(fila.attempts, 1);
    assert.equal(fila.lastError, "el destino respondió 503");
    assert.ok(fila.nextAttemptAt, "tiene que quedar programado un próximo turno");
    assert.ok(
      fila.nextAttemptAt.getTime() > Date.now(),
      "el próximo turno tiene que estar en el FUTURO",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("el backoff efectivamente pospone: la pasada inmediatamente siguiente NO vuelve a tomar el evento", async () => {
  // La aserción que hace que el backoff no sea decorativo. Sin ella, un
  // nextAttemptAt bien calculado pero ignorado por la consulta de reclamo
  // pasaría igual: el evento se reintentaría en bucle cerrado contra un destino
  // caído, que es justo lo que el backoff viene a evitar.
  const escenario = await montar("pospone");
  try {
    let invocaciones = 0;
    escenario.registro.registrar("test.pospone", async () => {
      invocaciones++;
      throw new Error("sigue caído");
    });

    await emitir(escenario, "test.pospone");

    await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });
    assert.equal(invocaciones, 1);

    const segunda = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });

    assert.equal(segunda.entregados + segunda.reprogramados + segunda.muertos, 0);
    assert.equal(invocaciones, 1, "el handler no debe volver a correr antes de su próximo turno");
  } finally {
    await desmontar(escenario);
  }
});

test("al agotar los intentos el evento pasa a DEAD_LETTER, con attempts en el máximo", async () => {
  const escenario = await montar("dead-letter");
  try {
    escenario.registro.registrar("test.muere", async () => {
      throw new Error("nunca funciona");
    });

    const evento = await emitir(escenario, "test.muere");

    // Se adelanta el reloj entre pasadas en vez de esperar el backoff real: lo
    // que se prueba es la máquina de estados, no el paso del tiempo.
    for (let i = 0; i < env.OUTBOX_MAX_ATTEMPTS; i++) {
      await drenarOutbox({
        organizationId: escenario.organizationId,
        registro: escenario.registro,
      });
      const parcial = await leer(evento.id);
      if (parcial.status === "PENDING") {
        await adelantarElReloj(evento.id);
      }
    }

    const fila = await leer(evento.id);
    assert.equal(fila.status, "DEAD_LETTER");
    assert.equal(fila.attempts, env.OUTBOX_MAX_ATTEMPTS);
    assert.equal(fila.lastError, "nunca funciona");
    assert.equal(fila.nextAttemptAt, null, "un DEAD_LETTER no tiene próximo turno");
  } finally {
    await desmontar(escenario);
  }
});

test("un DEAD_LETTER ya no se reclama: es terminal, nadie lo reintenta solo", async () => {
  const escenario = await montar("terminal");
  try {
    escenario.registro.registrar("test.terminal", async () => {
      throw new Error("nunca funciona");
    });

    const evento = await emitir(escenario, "test.terminal");
    for (let i = 0; i < env.OUTBOX_MAX_ATTEMPTS; i++) {
      await drenarOutbox({
        organizationId: escenario.organizationId,
        registro: escenario.registro,
      });
      const parcial = await leer(evento.id);
      if (parcial.status === "PENDING") {
        await adelantarElReloj(evento.id);
      }
    }
    assert.equal((await leer(evento.id)).status, "DEAD_LETTER");

    const despues = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });
    assert.equal(despues.entregados + despues.reprogramados + despues.muertos, 0);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Handler ausente
// ---------------------------------------------------------------------------

test("un eventType sin handler va DIRECTO a DEAD_LETTER, sin gastar un solo reintento", async () => {
  // Reintentar no hace aparecer un handler: es un bug de configuración, no una
  // falla transitoria. Gastar los 5 intentos solo retrasaría el diagnóstico
  // varios minutos y dejaría un contador que miente sobre qué se intentó.
  const escenario = await montar("sin-handler");
  try {
    const evento = await emitir(escenario, "test.nadie_lo_atiende");

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro, // vacío a propósito
    });

    assert.equal(resumen.muertos, 1);

    const fila = await leer(evento.id);
    assert.equal(fila.status, "DEAD_LETTER");
    assert.equal(fila.attempts, 0, "nadie intentó nada: el contador no se toca");
    assert.match(fila.lastError ?? "", /no hay handler registrado para "test\.nadie_lo_atiende"/);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Aislamiento y orden
// ---------------------------------------------------------------------------

test("un handler que falla no arrastra a los demás eventos de la misma pasada", async () => {
  // Cada evento va en su propia transacción, así que no hay ninguna transacción
  // compartida que un evento malo pueda abortar.
  const escenario = await montar("aislamiento");
  try {
    escenario.registro.registrar("test.ok", async () => undefined);
    escenario.registro.registrar("test.explota", async () => {
      throw new Error("boom");
    });

    const bueno1 = await emitir(escenario, "test.ok");
    const malo = await emitir(escenario, "test.explota");
    const bueno2 = await emitir(escenario, "test.ok");

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });

    assert.equal(resumen.entregados, 2);
    assert.equal(resumen.reprogramados, 1);
    assert.equal((await leer(bueno1.id)).status, "PROCESSED");
    assert.equal((await leer(bueno2.id)).status, "PROCESSED");
    assert.equal((await leer(malo.id)).status, "PENDING");
  } finally {
    await desmontar(escenario);
  }
});

test("el reclamo respeta el turno: un evento reprogramado cede el paso a uno recién emitido", async () => {
  // Es la consecuencia observable de ordenar por coalesce(next_attempt_at,
  // created_at): el que ya falló espera su turno aunque sea el más viejo.
  const escenario = await montar("orden");
  try {
    const entregados: string[] = [];
    escenario.registro.registrar("test.falla_primero", async () => {
      throw new Error("caído");
    });
    escenario.registro.registrar("test.llega_despues", async (evento) => {
      entregados.push(evento.eventType);
    });

    await emitir(escenario, "test.falla_primero");
    await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });

    // El segundo se emite DESPUÉS, así que es más nuevo por created_at — pero
    // está disponible ya, y el primero no.
    await emitir(escenario, "test.llega_despues");

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });

    assert.equal(resumen.entregados, 1);
    assert.deepEqual(entregados, ["test.llega_despues"]);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// M-14 de docs/auditoria-2026-08-29.md — la señal se aborta de verdad en el
// camino real, con transacción y todo, no solo en el aislamiento sin base de
// outbox.service.test.ts.
//
// OUTBOX_HANDLER_TIMEOUT_MS se baja temporariamente mutando `env` y se
// restaura en el finally —mismo criterio que adelantarElReloj: lo que importa
// es la máquina de estados, no esperar 10 s de verdad. No se simula la entrega
// duplicada en sí (necesitaría un destino externo real); lo que se fija es que
// el handler RECIBE una señal y que esa señal queda abortada cuando el evento
// ya se reprogramó.
// ---------------------------------------------------------------------------

test("M-14: al vencer el tope, la señal que recibió el handler queda abortada y el evento se reprograma con el tope en lastError", async () => {
  const escenario = await montar("m14-abort");
  const topeOriginal = env.OUTBOX_HANDLER_TIMEOUT_MS;
  env.OUTBOX_HANDLER_TIMEOUT_MS = 50;
  let capturada: AbortSignal | undefined;
  let liberar: () => void = () => undefined;

  try {
    escenario.registro.registrar("test.abort", async (evento) => {
      capturada = evento.signal;
      // Ignora la señal a propósito: nunca resuelve por su cuenta durante el
      // drenado. Es el handler del escenario del hallazgo.
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
    });

    const evento = await emitir(escenario, "test.abort");

    const resumen = await drenarOutbox({
      organizationId: escenario.organizationId,
      registro: escenario.registro,
    });
    assert.equal(resumen.reprogramados, 1);

    const fila = await leer(evento.id);
    assert.equal(fila.status, "PENDING");
    assert.equal(fila.attempts, 1);
    assert.match(fila.lastError ?? "", /no respondió en 50 ms/);

    assert.ok(capturada, "el handler tiene que haber recibido una señal");
    assert.equal(capturada.aborted, true);
  } finally {
    env.OUTBOX_HANDLER_TIMEOUT_MS = topeOriginal;
    liberar();
    await desmontar(escenario);
  }
});
