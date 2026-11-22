import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallDelTurno } from "./agentOrchestration.service";
import {
  accionesAfirmadas,
  accionesHechas,
  afirmacionesSinRespaldo,
  type AccionSobreTurnos,
} from "./afirmacionesDeTurnos";

// ---------------------------------------------------------------------------
// El agente no afirma ni promete un turno agendado, movido o cancelado que la
// tool no hizo en ese turno (prueba de la Clínica Demo, 2026-10-11; presente y
// promesa desde la QA de la primera clínica, 2026-11-21). Sin base: el
// detector. Las reglas de cada rubro, en src/clinicas/afirmacionesDeTurnos.test.ts.
// ---------------------------------------------------------------------------

const AFIRMAN: [string, AccionSobreTurnos][] = [
  // El caso real de la demo.
  ["He reservado para vos un turno con la Dra. Ejemplo. ¿Querés que te lo confirme?", "AGENDAR"],
  ["Listo, te reservé el lunes 12 a las 9:30.", "AGENDAR"],
  ["Ya agendé tu turno para el martes.", "AGENDAR"],
  ["Tu turno quedó agendado para el lunes.", "AGENDAR"],
  ["Quedó confirmado tu turno del lunes a las 10.", "AGENDAR"],
  ["Hemos reservado tu lugar.", "AGENDAR"],
  ["Reprogramé tu turno para el jueves.", "REPROGRAMAR"],
  ["Cambié tu turno al jueves a las 11.", "REPROGRAMAR"],
  ["Listo, lo pasé para el viernes a las 10.", "REPROGRAMAR"],
  ["Tu turno quedó reprogramado.", "REPROGRAMAR"],
  ["Cancelé tu turno del lunes.", "CANCELAR"],
  ["Tu turno quedó cancelado.", "CANCELAR"],
  ["El turno ha sido cancelado.", "CANCELAR"],
  ["Tu turno fue cancelado, cualquier cosa escribime.", "CANCELAR"],
  ["Listo, se canceló el turno.", "CANCELAR"],
  // QA de la primera clínica (2026-11-21): el caso real, en presente y con promesa.
  [
    "¡Buenísimo, Ana! Te reservo el turno para *manicura y uñas* con Lucía el *viernes 27 a las 09:40*.",
    "AGENDAR",
  ],
  ["En un momento te confirmo la reserva. ¿Necesitás algo más por ahora?", "AGENDAR"],
  ["Te confirmo el turno enseguida.", "AGENDAR"],
  ["Ya te confirmo el horario de la prueba de manejo.", "AGENDAR"],
  ["Sí, te lo agendo para el martes a las 10.", "AGENDAR"],
  ["Perfecto, se lo reservo ahora mismo.", "AGENDAR"],
  ["Voy a reservarte el lunes a las 9.", "AGENDAR"],
  ["Te lo reprogramo para el jueves a las 11.", "REPROGRAMAR"],
  ["Dale, te cancelo el turno del lunes.", "CANCELAR"],
  ["Vamos a cancelarlo entonces.", "CANCELAR"],
];

const NO_AFIRMAN = [
  "¿Querés que te reserve el lunes a las 9:30?",
  "¿Lo cancelamos?",
  "Todavía no quedó reservado: necesito tu apellido.",
  "No reservé nada todavía.",
  "Aún no cancelé el turno; ¿me confirmás?",
  "Tenés un turno el lunes 12 de octubre a las 9:30 con la Dra. Ejemplo.",
  "Hay lugar el lunes a las 9:30 y a las 10:30. ¿Cuál preferís?",
  "Si querés, lo reservamos ahora.",
  "Te pasé los precios más arriba.",
  "Quedó registrado tu email, gracias.",
  "He cambiado tus datos de contacto.",
  "Para cancelar, decime cuál de tus turnos es.",
  "Este es el resumen: lunes 12 de octubre, 09:30, Limpieza facial. ¿Confirmás que lo querés cancelar?",
  // Presente y promesa que NO afirman (QA de la primera clínica).
  "¿Te reservo el turno del lunes a las 10?",
  "Te reservo el de las 10, ¿te parece?",
  "Si querés, te lo reservo para el martes.",
  "Si te sirve, te agendo el de las 9.",
  "No te lo puedo reservar por este medio.",
  "Te confirmo el precio en un momento.",
  "Te anoto el teléfono para que te llamen.",
  "La reserva la hace una persona del equipo.",
];

test("detecta las afirmaciones y las promesas de un turno", () => {
  for (const [frase, accion] of AFIRMAN) {
    assert.ok(accionesAfirmadas(frase).has(accion), frase);
  }
});

test("no confunde preguntas, condicionales, negaciones, turnos que ya existen ni otras acciones", () => {
  for (const frase of NO_AFIRMAN) {
    assert.deepEqual([...accionesAfirmadas(frase)], [], frase);
  }
});

function llamada(
  name: string,
  result: ToolCallDelTurno["result"],
  allowed = true,
): ToolCallDelTurno {
  return { id: `c-${name}`, name, arguments: {}, allowed, result };
}

test("lo respalda solo la tool que lo hace, con ok y en este turno", () => {
  const reserva = llamada("create_booking", { ok: true, data: { bookingId: "b1" } });
  const movido = llamada("reschedule_booking", { ok: true, data: { bookingId: "b1" } });
  const resumen = llamada("cancel_booking", {
    ok: true,
    data: { bookingId: "b1", requiereConfirmacion: true, cancelado: false },
  });
  const cancelado = llamada("cancel_booking", {
    ok: true,
    data: { bookingId: "b1", cancelado: true },
  });
  const fallida = llamada("create_booking", { ok: false, error: "Ocupado" });
  const bloqueada = llamada("create_booking", undefined, false);
  const consulta = llamada("get_availability", { ok: true, data: { turnos: [] } });

  assert.deepEqual([...accionesHechas([reserva])], ["AGENDAR"]);
  assert.deepEqual([...accionesHechas([movido])].sort(), ["AGENDAR", "REPROGRAMAR"]);
  assert.deepEqual([...accionesHechas([resumen, fallida, bloqueada, consulta])], []);
  assert.deepEqual([...accionesHechas([cancelado])], ["CANCELAR"]);

  const caso = "He reservado para vos un turno con la Dra. Ejemplo.";
  assert.deepEqual(afirmacionesSinRespaldo(caso, []), ["AGENDAR"]);
  assert.deepEqual(afirmacionesSinRespaldo(caso, [consulta]), ["AGENDAR"]);
  assert.deepEqual(afirmacionesSinRespaldo(caso, [reserva]), []);
  assert.deepEqual(afirmacionesSinRespaldo("Tu turno quedó cancelado.", [resumen]), ["CANCELAR"]);
  assert.deepEqual(afirmacionesSinRespaldo("Tu turno quedó cancelado.", [cancelado]), []);
  assert.deepEqual(afirmacionesSinRespaldo("Cancelé tu turno.", [reserva]), ["CANCELAR"]);
  // La promesa también necesita la tool; con la reserva hecha, "te reservo" sale.
  const promesa = "Te reservo el turno. En un momento te confirmo la reserva.";
  assert.deepEqual(afirmacionesSinRespaldo(promesa, [consulta]), ["AGENDAR"]);
  assert.deepEqual(afirmacionesSinRespaldo(promesa, [fallida]), ["AGENDAR"]);
  assert.deepEqual(afirmacionesSinRespaldo(promesa, [reserva]), []);
});
