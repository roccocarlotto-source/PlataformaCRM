import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallDelTurno } from "../services/agentOrchestration.service";
import { accionesAfirmadas, REGLA_AFIRMACION_SIN_ACCION } from "../services/afirmacionesDeTurnos";
import {
  MENSAJE_AFIRMACION_SIN_ACCION_DE_AUTOMOTORA,
  primeraCorreccionDeSalida,
  reglasDelRubro,
} from "../services/reglasDelRubro";
import {
  CODIGO_TURNO_REPETIDO,
  CUERPO_DE_LA_TAREA_TURNO_REPETIDO,
  MOTIVO_CAMBIO_DE_TURNO_POR_EL_CHAT,
  mensajeDeTurnoRepetido,
} from "../services/turnoRepetido";
import { MENSAJE_AFIRMACION_SIN_ACCION } from "./config/textosDelAgente";
import { daIndicacionClinica } from "./guardrailsDeSalud";
import { CODIGO_FUERA_DE_PLAZO } from "./toolsDeTurnos";

// ---------------------------------------------------------------------------
// Las reglas de cada rubro sobre los turnos del agente (el detector, en
// src/services/afirmacionesDeTurnos.test.ts):
//   - la guarda de salida: un turno afirmado o prometido sin la tool que lo
//     hace no sale, y va el mensaje fijo del rubro (los dos rubros desde la QA
//     de la primera clínica, 2026-11-21);
//   - la derivación desde el código cuando create_booking rechaza por un turno
//     repetido (src/services/turnoRepetido.ts), en los dos rubros.
// ---------------------------------------------------------------------------

const contexto = { nombreDeLaOrganizacion: "Negocio Ejemplo" };
const PROMESA = "Te reservo el turno del viernes a las 9:40. En un momento te confirmo la reserva.";

test("los dos rubros corrigen una afirmación o una promesa sin respaldo, cada uno con su mensaje fijo", () => {
  for (const [rubro, mensaje] of [
    ["CLINICA", MENSAJE_AFIRMACION_SIN_ACCION],
    ["AUTOMOTORA", MENSAJE_AFIRMACION_SIN_ACCION_DE_AUTOMOTORA],
  ] as const) {
    const correcciones = reglasDelRubro(rubro).correccionesDeSalida;
    for (const respuesta of [
      "Te reservé el turno del lunes.",
      PROMESA,
      "Te reservé el test drive.",
    ]) {
      assert.deepEqual(
        primeraCorreccionDeSalida(correcciones, respuesta, [], contexto),
        { regla: REGLA_AFIRMACION_SIN_ACCION, mensaje },
        `${rubro}: ${respuesta}`,
      );
    }
    // Una pregunta, o la reserva hecha en este turno, salen.
    assert.equal(
      primeraCorreccionDeSalida(correcciones, "¿Te reservo el lunes a las 9?", [], contexto),
      null,
    );
    const reserva: ToolCallDelTurno = {
      id: "c1",
      name: "create_booking",
      arguments: {},
      allowed: true,
      result: { ok: true, data: { bookingId: "b1" } },
    };
    assert.equal(primeraCorreccionDeSalida(correcciones, PROMESA, [reserva], contexto), null);
    // El mensaje fijo no afirma nada.
    assert.deepEqual([...accionesAfirmadas(mensaje)], [], mensaje);
  }
  // Y el de una clínica tampoco dispara la capa 3.
  assert.equal(daIndicacionClinica(MENSAJE_AFIRMACION_SIN_ACCION), false);
});

function rechazo(codigo: string): ToolCallDelTurno {
  return {
    id: "c1",
    name: "create_booking",
    arguments: {},
    allowed: true,
    result: { ok: false, error: "ya tiene un turno de ese servicio", codigo },
  };
}

test("un turno repetido sin reschedule_booking deriva desde el código, con tarea 'quiere cambiar su turno', en los dos rubros", () => {
  for (const rubro of ["CLINICA", "AUTOMOTORA"] as const) {
    const desenlace = reglasDelRubro(rubro).desenlaceDeLasTools;
    assert.ok(desenlace, rubro);
    assert.deepEqual(desenlace([rechazo(CODIGO_TURNO_REPETIDO)], contexto), {
      tipo: "derivar",
      decision: {
        regla: "turno_del_mismo_servicio",
        motivo: MOTIVO_CAMBIO_DE_TURNO_POR_EL_CHAT,
        mensaje: mensajeDeTurnoRepetido("Negocio Ejemplo"),
        aviso: { cuerpo: CUERPO_DE_LA_TAREA_TURNO_REPETIDO, urgente: false },
      },
    });
    // Un rechazo sin código (con reschedule_booking, el modelo la usa) no deriva.
    const sinCodigo: ToolCallDelTurno = {
      ...rechazo(CODIGO_TURNO_REPETIDO),
      result: { ok: false, error: "usá reschedule_booking" },
    };
    assert.equal(desenlace([sinCodigo], contexto), null, rubro);
  }
  assert.match(CUERPO_DE_LA_TAREA_TURNO_REPETIDO, /^Quiere cambiar su turno/);
  // El "fuera de plazo" sigue siendo solo de clínica.
  assert.equal(
    reglasDelRubro("AUTOMOTORA").desenlaceDeLasTools?.([rechazo(CODIGO_FUERA_DE_PLAZO)], contexto),
    null,
  );
  // El mensaje a la persona no afirma un turno hecho.
  assert.deepEqual([...accionesAfirmadas(mensajeDeTurnoRepetido("Negocio Ejemplo"))], []);
});
