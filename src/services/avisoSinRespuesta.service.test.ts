import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVISO_SIN_RESPUESTA,
  MOTIVO_CANAL_SIN_ENVIO,
  MOTIVO_VENTANA_CERRADA,
  asuntoDeTareaSinRespuesta,
  debeAvisarAlDevolver,
  entregaDelAviso,
  marcaSinRespuesta,
} from "./avisoSinRespuesta.service";

// "Devolver al agente" sin haberle respondido al cliente: las reglas puras,
// con fechas fijas. El recorrido HTTP contra Postgres está en
// conversationReply.integration-test.ts.

const AHORA = new Date("2026-10-01T12:00:00.000Z");
const HORA = 60 * 60 * 1000;

test("el aviso es el texto fijo acordado, no algo que genera el modelo", () => {
  assert.equal(
    AVISO_SIN_RESPUESTA,
    "Por el momento no hay nadie del equipo disponible. Te vamos a contactar más tarde. Mientras tanto, si querés, puedo seguir ayudándote.",
  );
});

test("sin respuesta de una persona desde la derivación: se avisa", () => {
  assert.equal(
    debeAvisarAlDevolver({ status: "TRANSFERRED_TO_HUMAN", humanoRespondio: false }),
    true,
  );
});

test("con respuesta de una persona: todo queda como antes, sin aviso", () => {
  assert.equal(
    debeAvisarAlDevolver({ status: "TRANSFERRED_TO_HUMAN", humanoRespondio: true }),
    false,
  );
});

test("idempotencia: una ya devuelta (ACTIVE) o cerrada no vuelve a avisar", () => {
  assert.equal(debeAvisarAlDevolver({ status: "ACTIVE", humanoRespondio: false }), false);
  assert.equal(debeAvisarAlDevolver({ status: "CLOSED", humanoRespondio: false }), false);
});

test("WhatsApp con la ventana abierta: se manda", () => {
  const fin = new Date(AHORA.getTime() + HORA);
  assert.deepEqual(entregaDelAviso("WHATSAPP", fin, AHORA), { tipo: "whatsapp" });
});

test("WhatsApp con la ventana cerrada, o sin mensaje del cliente: no se manda", () => {
  const vencida = new Date(AHORA.getTime() - HORA);
  const esperado = { tipo: "no-se-envia", motivo: MOTIVO_VENTANA_CERRADA };
  assert.deepEqual(entregaDelAviso("WHATSAPP", vencida, AHORA), esperado);
  assert.deepEqual(entregaDelAviso("WHATSAPP", null, AHORA), esperado);
  assert.deepEqual(
    entregaDelAviso("WHATSAPP", AHORA, AHORA),
    esperado,
    "justo a las 24 h ya cerró",
  );
});

test("Web: se guarda en el hilo; Messenger e Instagram, como en I-03, no se mandan", () => {
  assert.deepEqual(entregaDelAviso("WEB", null, AHORA), { tipo: "solo-hilo" });
  const abierta = new Date(AHORA.getTime() + HORA);
  for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
    assert.deepEqual(entregaDelAviso(canal, abierta, AHORA), {
      tipo: "no-se-envia",
      motivo: MOTIVO_CANAL_SIN_ENVIO,
    });
  }
});

test("la tarea sin vendedor se llama como pidió Rocco y entra en 255", () => {
  assert.equal(
    asuntoDeTareaSinRespuesta("Ana Pérez"),
    "Contactar a Ana Pérez: pidió hablar con una persona y nadie respondió",
  );
  assert.equal(asuntoDeTareaSinRespuesta("x".repeat(400)).length, 255);
});

test("marca: aviso sin respuesta y tarea abierta → se ve", () => {
  assert.equal(
    marcaSinRespuesta({
      hayAviso: true,
      humanoEscribioDespues: false,
      tarea: { completedAt: null },
    }),
    true,
  );
});

test("marca: sin vendedor ni tarea, se ve hasta que una persona escriba", () => {
  assert.equal(
    marcaSinRespuesta({ hayAviso: true, humanoEscribioDespues: false, tarea: null }),
    true,
  );
});

test("marca: desaparece cuando una persona le escribe o se completa la tarea", () => {
  assert.equal(
    marcaSinRespuesta({
      hayAviso: true,
      humanoEscribioDespues: true,
      tarea: { completedAt: null },
    }),
    false,
  );
  assert.equal(
    marcaSinRespuesta({
      hayAviso: true,
      humanoEscribioDespues: false,
      tarea: { completedAt: AHORA },
    }),
    false,
  );
});

test("marca: sin aviso no hay marca", () => {
  assert.equal(
    marcaSinRespuesta({ hayAviso: false, humanoEscribioDespues: false, tarea: null }),
    false,
  );
});
