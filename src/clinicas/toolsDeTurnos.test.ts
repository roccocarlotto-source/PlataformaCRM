import assert from "node:assert/strict";
import { test } from "node:test";
import {
  armarSystemPrompt,
  textosDeAutomotora,
  type ToolCallDelTurno,
} from "../services/agentOrchestration.service";
import { reglasDelRubro } from "../services/reglasDelRubro";
import {
  CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO,
  INSTRUCCION_DE_FECHAS_DE_CLINICA,
  INSTRUCCION_DE_TONO_DE_CLINICA,
  MOTIVO_CAMBIO_FUERA_DE_PLAZO,
  mensajeDeCambioFueraDePlazo,
  sinDeEjemplo,
} from "./config/textosDelAgente";
import { clasificarMensajeDeSalud, daIndicacionClinica } from "./guardrailsDeSalud";
import { desenlaceDeClinica } from "./reglasDeClinica";
import { TOOL_DE_INDICACIONES } from "./toolDeIndicaciones";
import { cuandoEnLaSede } from "./toolsDeAgenda";
import {
  CODIGO_FUERA_DE_PLAZO,
  CODIGO_SIN_AUTOR,
  cancelBookingArgs,
  mostroElResumenDeCancelar,
} from "./toolsDeTurnos";

// ---------------------------------------------------------------------------
// Hallazgos de la prueba de la Clínica Demo (2026-10-11), sin base: el día ya
// escrito, la derivación por un rechazo con código, el resumen de cancelar,
// el tono y "de ejemplo".
// ---------------------------------------------------------------------------

test("cuando: el día de la semana correcto en la zona de la sede", () => {
  // 2026-10-12 es lunes. 12:30Z son las 09:30 en Montevideo.
  assert.equal(
    cuandoEnLaSede(new Date("2026-10-12T12:30:00Z"), "America/Montevideo"),
    "lunes 12 de octubre, 09:30",
  );
  // 01:00Z del martes todavía es lunes a la noche en Buenos Aires.
  assert.equal(
    cuandoEnLaSede(new Date("2026-10-13T01:00:00Z"), "America/Argentina/Buenos_Aires"),
    "lunes 12 de octubre, 22:00",
  );
});

function rechazo(codigo?: string): ToolCallDelTurno {
  return {
    id: "c1",
    name: "reschedule_booking",
    arguments: {},
    allowed: true,
    result: { ok: false, error: "No se puede", ...(codigo ? { codigo } : {}) },
  };
}

const contexto = { nombreDeLaOrganizacion: "Clínica Ejemplo" };

test("un rechazo con código deriva desde el código, y gana sobre una indicación de la misma ronda", () => {
  const indicacion: ToolCallDelTurno = {
    id: "c2",
    name: TOOL_DE_INDICACIONES,
    arguments: {},
    allowed: true,
    result: { ok: true, data: { texto: "Protector solar." } },
  };
  assert.deepEqual(desenlaceDeClinica([indicacion, rechazo(CODIGO_FUERA_DE_PLAZO)], contexto), {
    tipo: "derivar",
    decision: {
      regla: "cambio_de_turno_fuera_de_plazo",
      motivo: MOTIVO_CAMBIO_FUERA_DE_PLAZO,
      mensaje: mensajeDeCambioFueraDePlazo("Clínica Ejemplo"),
      aviso: { cuerpo: CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO, urgente: false },
    },
  });
  const sinAutor = desenlaceDeClinica([rechazo(CODIGO_SIN_AUTOR)], contexto);
  assert.equal(sinAutor?.tipo, "derivar");
  // Sin código, o con uno que no deriva: el modelo sigue.
  assert.equal(desenlaceDeClinica([rechazo()], contexto), null);
  assert.equal(desenlaceDeClinica([rechazo("OTRO")], contexto), null);
  assert.equal(desenlaceDeClinica([rechazo("toString")], contexto), null);
  // El mensaje fijo no dispara los guardrails de salud.
  for (const texto of [
    mensajeDeCambioFueraDePlazo("Clínica Ejemplo"),
    CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO,
  ]) {
    assert.equal(clasificarMensajeDeSalud(texto), "NINGUNO", texto);
    assert.equal(daIndicacionClinica(texto), false, texto);
  }
});

test("cancelar en dos pasos: el resumen guardado se reconoce por turno, y confirmado solo vale con true", () => {
  const resumen = {
    id: "c1",
    name: "cancel_booking",
    arguments: { bookingId: "b1" },
    allowed: true,
    result: { ok: true, data: { bookingId: "b1", requiereConfirmacion: true, cancelado: false } },
  };
  assert.equal(mostroElResumenDeCancelar([resumen], "b1"), true);
  assert.equal(mostroElResumenDeCancelar([resumen], "b2"), false);
  assert.equal(
    mostroElResumenDeCancelar(
      [{ ...resumen, result: { ok: true, data: { bookingId: "b1", cancelado: true } } }],
      "b1",
    ),
    false,
  );
  assert.equal(
    mostroElResumenDeCancelar([{ ...resumen, name: "reschedule_booking" }], "b1"),
    false,
  );
  assert.equal(mostroElResumenDeCancelar(null, "b1"), false);
  assert.equal(mostroElResumenDeCancelar("basura", "b1"), false);

  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(cancelBookingArgs.parse({ bookingId: id }).confirmado, undefined);
  assert.equal(cancelBookingArgs.parse({ bookingId: id, confirmado: true }).confirmado, true);
  assert.equal(cancelBookingArgs.parse({ bookingId: id, confirmado: "true" }).confirmado, true);
  assert.equal(cancelBookingArgs.parse({ bookingId: id, confirmado: "sí" }).confirmado, false);
  assert.equal(cancelBookingArgs.parse({ bookingId: id, confirmado: null }).confirmado, false);
});

test("tono: el prompt de una clínica pide voseo y fechas de las tools; el de una automotora no cambia", () => {
  const agente = { instructions: "Sos el asistente.", tone: null, guardrails: {} };
  const clinica = armarSystemPrompt(
    agente,
    [],
    undefined,
    undefined,
    null,
    [],
    undefined,
    [],
    null,
    reglasDelRubro("CLINICA").instruccionesDelPrompt,
  );
  assert.ok(clinica.includes(INSTRUCCION_DE_TONO_DE_CLINICA));
  assert.ok(clinica.includes(INSTRUCCION_DE_FECHAS_DE_CLINICA));
  assert.match(INSTRUCCION_DE_TONO_DE_CLINICA, /tratando de vos/);
  assert.match(INSTRUCCION_DE_TONO_DE_CLINICA, /de ejemplo/);
  const automotora = armarSystemPrompt(
    agente,
    [],
    undefined,
    undefined,
    null,
    [],
    undefined,
    [],
    null,
    reglasDelRubro("AUTOMOTORA").instruccionesDelPrompt,
    true,
    textosDeAutomotora(),
  );
  assert.ok(!automotora.includes(INSTRUCCION_DE_TONO_DE_CLINICA));
  assert.ok(!automotora.includes(INSTRUCCION_DE_FECHAS_DE_CLINICA));
});

test("sin «de ejemplo»: sale de la respuesta, «por ejemplo» queda, y es un retoque solo de clínica", () => {
  assert.equal(
    sinDeEjemplo("Los precios de ejemplo son: limpieza $1.500."),
    "Los precios son: limpieza $1.500.",
  );
  assert.equal(sinDeEjemplo("Precios De Ejemplo: $1.500"), "Precios: $1.500");
  assert.equal(
    sinDeEjemplo("Por ejemplo, la limpieza dura una hora."),
    "Por ejemplo, la limpieza dura una hora.",
  );
  assert.deepEqual(reglasDelRubro("CLINICA").retoquesDeSalida, [sinDeEjemplo]);
  assert.deepEqual(reglasDelRubro("AUTOMOTORA").retoquesDeSalida, []);
});
