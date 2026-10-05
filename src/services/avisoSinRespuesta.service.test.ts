import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avisoLlegaTarde,
  topeDeAntiguedadDelAvisoMs,
  AVISO_SIN_RESPUESTA,
  MOTIVO_VENTANA_CERRADA,
  MOTIVO_VENTANA_CERRADA_META,
  PREFIJO_DEL_AVISO,
  asuntoDeTareaSinRespuesta,
  textoDelAviso,
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

test("textoDelAviso: dentro de horario o sin horario cargado, el de siempre", () => {
  assert.equal(textoDelAviso(null), AVISO_SIN_RESPUESTA);
});

test("textoDelAviso: fuera de horario dice cuándo atienden y cuándo le escriben, con el mismo comienzo", () => {
  const texto = textoDelAviso({
    horario: "de lunes a sábado de 9 a 20 h",
    cuando: "el lunes a partir de las 9",
    proximaApertura: new Date("2026-10-12T12:00:00.000Z"),
  });
  assert.equal(
    texto,
    "Por el momento no hay nadie del equipo disponible. Nuestro equipo atiende de lunes a sábado de 9 a 20 h. Te vamos a escribir el lunes a partir de las 9. Mientras tanto, si querés, puedo seguir ayudándote.",
  );
  assert.ok(texto.startsWith(PREFIJO_DEL_AVISO));
  assert.ok(AVISO_SIN_RESPUESTA.startsWith(PREFIJO_DEL_AVISO));
});

test("textoDelAviso con el texto del agente: ese texto; fuera de horario, con la frase del horario al final", () => {
  const propio = "Ahora no hay vendedores conectados, te escribimos apenas se libere uno.";
  assert.equal(textoDelAviso(null, `  ${propio}  `), propio);
  assert.equal(
    textoDelAviso(
      {
        horario: "de lunes a sábado de 9 a 20 h",
        cuando: "mañana a partir de las 9",
        proximaApertura: new Date("2026-10-12T12:00:00.000Z"),
      },
      propio,
    ),
    `${propio} Nuestro equipo atiende de lunes a sábado de 9 a 20 h. Te vamos a escribir mañana a partir de las 9.`,
  );
});

test("textoDelAviso: un texto del agente vacío o en blanco es el de siempre", () => {
  assert.equal(textoDelAviso(null, ""), AVISO_SIN_RESPUESTA);
  assert.equal(textoDelAviso(null, "   "), AVISO_SIN_RESPUESTA);
  assert.equal(textoDelAviso(null, null), AVISO_SIN_RESPUESTA);
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
  assert.deepEqual(entregaDelAviso("WHATSAPP", fin, AHORA), { tipo: "por-el-canal" });
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

test("Web: sale siempre (el widget lo trae del hilo), sin ventana", () => {
  assert.deepEqual(entregaDelAviso("WEB", null, AHORA), { tipo: "por-el-canal" });
});

test("Messenger e Instagram: con la ventana abierta se manda; cerrada, el motivo de Meta", () => {
  const abierta = new Date(AHORA.getTime() + HORA);
  const vencida = new Date(AHORA.getTime() - HORA);
  for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
    assert.deepEqual(entregaDelAviso(canal, abierta, AHORA), { tipo: "por-el-canal" });
    assert.deepEqual(entregaDelAviso(canal, vencida, AHORA), {
      tipo: "no-se-envia",
      motivo: MOTIVO_VENTANA_CERRADA_META,
    });
    assert.deepEqual(entregaDelAviso(canal, null, AHORA), {
      tipo: "no-se-envia",
      motivo: MOTIVO_VENTANA_CERRADA_META,
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

// --- Tope de antigüedad del aviso automático (FABLE-G-02 / OPUS-D-02,
// docs-privados, local) -------------------------------------------------------

test("tope de antigüedad: 3 veces los minutos, y nunca menos de 10 minutos de tolerancia", () => {
  const MIN = 60 * 1000;
  assert.equal(topeDeAntiguedadDelAvisoMs(1), 11 * MIN);
  assert.equal(topeDeAntiguedadDelAvisoMs(2), 12 * MIN);
  assert.equal(topeDeAntiguedadDelAvisoMs(5), 15 * MIN);
  assert.equal(topeDeAntiguedadDelAvisoMs(15), 45 * MIN);
  assert.equal(topeDeAntiguedadDelAvisoMs(60), 180 * MIN);
});

test("avisoLlegaTarde: dentro del tope se avisa; pasado el tope ya no se le escribe al cliente", () => {
  const MIN = 60 * 1000;
  const hace = (minutos: number) => new Date(AHORA.getTime() - minutos * MIN);
  // 15 minutos configurados: el aviso vale hasta los 45.
  assert.equal(avisoLlegaTarde(hace(16), 15, AHORA), false);
  assert.equal(avisoLlegaTarde(hace(45), 15, AHORA), false);
  assert.equal(avisoLlegaTarde(hace(46), 15, AHORA), true);
  // El caso de la auditoría: el proceso durmió cinco horas.
  assert.equal(avisoLlegaTarde(hace(5 * 60), 15, AHORA), true);
  // 2 minutos (el valor de un negocio real): un reinicio de 8 minutos no se
  // come el aviso; media hora sí.
  assert.equal(avisoLlegaTarde(hace(10), 2, AHORA), false);
  assert.equal(avisoLlegaTarde(hace(30), 2, AHORA), true);
});
