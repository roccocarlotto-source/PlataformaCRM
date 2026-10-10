import assert from "node:assert/strict";
import { test } from "node:test";
import { cuerpoDeAltaDePlantilla, cuerpoDePlantilla } from "../../services/whatsappGraph.service";
import { leerMensaje } from "../../services/whatsappWebhook.service";
import {
  VARIABLES_DE_RECORDATORIO,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import {
  TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
  cuandoSaleElRecordatorio,
  cuandoVaLaTareaSinRespuesta,
  diaYHora,
  esRespuestaDelBoton,
  lugarDelTurno,
  mensajeDeError,
} from "./config";

// ---------------------------------------------------------------------------
// R13 (docs/rubros.md §6), sin base: el cálculo de los horarios, el {lugar},
// la limpieza de last_error, el botón en el webhook y el cuerpo de Meta.
// ---------------------------------------------------------------------------

const H = 60 * 60 * 1000;
const TURNO = new Date("2027-03-01T12:00:00Z");
const base = { reminderHoursBefore: 24, lateBookingHoursBefore: 2 };

test("cuandoSaleElRecordatorio: con tiempo, 24 h antes; con poca anticipación, según la política", () => {
  const conTiempo = new Date(TURNO.getTime() - 48 * H);
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, conTiempo, {
      ...base,
      lateBookingReminder: "NO_ENVIAR",
    })?.toISOString(),
    new Date(TURNO.getTime() - 24 * H).toISOString(),
  );
  const tarde = new Date(TURNO.getTime() - 5 * H);
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, tarde, { ...base, lateBookingReminder: "NO_ENVIAR" }),
    null,
  );
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, tarde, {
      ...base,
      lateBookingReminder: "EN_EL_MOMENTO",
    })?.toISOString(),
    tarde.toISOString(),
  );
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, tarde, {
      ...base,
      lateBookingReminder: "HORAS_ANTES",
    })?.toISOString(),
    new Date(TURNO.getTime() - 2 * H).toISOString(),
  );
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, new Date(TURNO.getTime() - H), {
      ...base,
      lateBookingReminder: "HORAS_ANTES",
    }),
    null,
  );
  // Un turno que ya empezó no se recuerda.
  assert.equal(
    cuandoSaleElRecordatorio(TURNO, TURNO, { ...base, lateBookingReminder: "EN_EL_MOMENTO" }),
    null,
  );
});

test("cuandoVaLaTareaSinRespuesta: 4 h después o 2 h antes del turno; a menos de 2 h, no hay", () => {
  const enviado = new Date(TURNO.getTime() - 24 * H);
  assert.equal(
    cuandoVaLaTareaSinRespuesta(enviado, TURNO, 4)?.toISOString(),
    new Date(enviado.getTime() + 4 * H).toISOString(),
  );
  const cerca = new Date(TURNO.getTime() - 3 * H);
  assert.equal(
    cuandoVaLaTareaSinRespuesta(cerca, TURNO, 4)?.toISOString(),
    new Date(TURNO.getTime() - 2 * H).toISOString(),
  );
  assert.equal(cuandoVaLaTareaSinRespuesta(new Date(TURNO.getTime() - H), TURNO, 4), null);
});

test("{lugar}: la clínica con una sede, «Clínica (sede X)» con más; {dia} y {hora} en la zona", () => {
  assert.equal(lugarDelTurno("Clínica Ejemplo", "Centro", 1), "Clínica Ejemplo");
  assert.equal(lugarDelTurno("Clínica Ejemplo", "Centro", 2), "Clínica Ejemplo (sede Centro)");
  assert.deepEqual(diaYHora(TURNO, "America/Argentina/Buenos_Aires"), {
    dia: "lunes 1 de marzo",
    hora: "09:00",
  });
});

test("mensajeDeError: sin tokens y cortado a 500", () => {
  const limpio = mensajeDeError(
    "Bearer EAAGabc123def456ghi access_token=EAAXYZ123456789012 ya29.abc 1//refresh " +
      "x".repeat(600),
  );
  assert.doesNotMatch(limpio, /EAAG|EAAX|ya29\.abc|1\/\/refresh/);
  assert.equal(limpio.length, 500);
});

test("el texto por defecto pasa la validación y no lleva la prestación", () => {
  assert.equal(
    validarTextoDePlantilla(TEXTO_POR_DEFECTO_DEL_RECORDATORIO, {
      variables: VARIABLES_DE_RECORDATORIO,
    }),
    null,
  );
  assert.doesNotMatch(TEXTO_POR_DEFECTO_DEL_RECORDATORIO, /prestaci/i);
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, tu turno de {prestacion} es el {dia} a las {hora}.", {
      variables: VARIABLES_DE_RECORDATORIO,
    }) ?? "",
    /no es una variable válida/,
  );
});

test("el webhook lee el payload y el context.id del botón; sin ellos, el mensaje de siempre", () => {
  const conBoton = leerMensaje({
    id: "wamid.r",
    from: "59899000000",
    type: "button",
    button: { text: "Confirmo", payload: "CONFIRMAR" },
    context: { id: "wamid.enviado" },
  });
  assert.deepEqual(conBoton, {
    wamid: "wamid.r",
    waId: "59899000000",
    texto: "Confirmo",
    boton: { payload: "CONFIRMAR", contextId: "wamid.enviado" },
  });
  assert.deepEqual(
    leerMensaje({
      id: "wamid.s",
      from: "59899000000",
      type: "button",
      button: { text: "Sí, me interesa" },
    }),
    { wamid: "wamid.s", waId: "59899000000", texto: "Sí, me interesa" },
  );
  assert.equal(esRespuestaDelBoton("CONFIRMAR"), true);
  assert.equal(esRespuestaDelBoton("OTRA"), false);
});

test("Meta: el alta con botones suma BUTTONS; sin botones, el cuerpo de siempre", () => {
  const sin = cuerpoDeAltaDePlantilla({
    name: "x",
    language: "es_AR",
    category: "MARKETING",
    bodyText: "Hola {{1}}",
    bodyExamples: ["Ana"],
  });
  assert.deepEqual(sin.components, [
    { type: "BODY", text: "Hola {{1}}", example: { body_text: [["Ana"]] } },
  ]);
  const con = cuerpoDeAltaDePlantilla({
    name: "x",
    language: "es_AR",
    category: "UTILITY",
    bodyText: "Hola {{1}}",
    bodyExamples: ["Ana"],
    quickReplyButtons: ["Confirmo", "Necesito cancelar"],
  });
  assert.deepEqual(con.components[1], {
    type: "BUTTONS",
    buttons: [
      { type: "QUICK_REPLY", text: "Confirmo" },
      { type: "QUICK_REPLY", text: "Necesito cancelar" },
    ],
  });
  const envio = cuerpoDePlantilla({
    to: "59899",
    templateName: "x",
    languageCode: "es_AR",
    bodyParameters: ["Ana"],
    quickReplyPayloads: ["CONFIRMAR", "CANCELAR"],
  });
  assert.deepEqual(envio.template.components?.slice(1), [
    {
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "CONFIRMAR" }],
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "1",
      parameters: [{ type: "payload", payload: "CANCELAR" }],
    },
  ]);
  const sinBotones = cuerpoDePlantilla({
    to: "59899",
    templateName: "x",
    languageCode: "es_AR",
    bodyParameters: ["Ana"],
  });
  assert.equal(sinBotones.template.components?.length, 1);
});
