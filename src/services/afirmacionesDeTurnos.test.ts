import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallDelTurno } from "./agentOrchestration.service";
import {
  accionesAfirmadas,
  accionesHechas,
  afirmacionesSinRespaldo,
  coincideConUnTurnoExistente,
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
  ["Listo, te reservé el turno del lunes 12 a las 9:30.", "AGENDAR"],
  ["Ya agendé tu turno para el martes.", "AGENDAR"],
  ["Tu turno quedó agendado para el lunes.", "AGENDAR"],
  ["Quedó confirmado tu turno del lunes a las 10.", "AGENDAR"],
  ["Hemos reservado tu lugar para la sesión.", "AGENDAR"],
  ["Reprogramé tu turno para el jueves.", "REPROGRAMAR"],
  ["Cambié tu turno al jueves a las 11.", "REPROGRAMAR"],
  ["Listo, lo pasé para el viernes a las 10, el turno queda con Ana.", "REPROGRAMAR"],
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
  ["En un momento te confirmo la reserva del turno. ¿Necesitás algo más por ahora?", "AGENDAR"],
  ["Te confirmo el turno enseguida.", "AGENDAR"],
  ["Ya te confirmo el horario de la prueba de manejo.", "AGENDAR"],
  ["Sí, te agendo la cita para el martes a las 10.", "AGENDAR"],
  ["Perfecto, le reservo la consulta ahora mismo.", "AGENDAR"],
  ["Voy a reservarte el test drive del lunes a las 9.", "AGENDAR"],
  ["Te reprogramo el turno para el jueves a las 11.", "REPROGRAMAR"],
  ["Dale, te cancelo el turno del lunes.", "CANCELAR"],
  ["Vamos a cancelarlo entonces, el turno queda libre.", "CANCELAR"],
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
  // Sin una palabra de turno (turno, cita, prueba de manejo, test drive,
  // consulta, sesión) la guarda no actúa: decisión de Rocco (2026-11-22),
  // mejor dejar pasar un caso dudoso que mandar una disculpa sin sentido.
  "Listo, te reservé el lunes 12 a las 9:30.",
  "Sí, te lo agendo para el martes a las 10.",
  "En un momento te confirmo la reserva.",
  // Los dos falsos positivos reales (eval con anthropic/claude-haiku-5.5, 2026-11-22).
  "Listo, Sofía: el Renault Kwid Zen 2021 quedó reservado a tu nombre. Lo tenés apartado mientras el equipo no lo libere.",
  "Cuando tengamos la unidad, te reservo el turno y te confirmo. Recordá traer la libreta de conducir.",
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

test("un reserve_vehicle exitoso respalda 'quedó reservado' en una oración que nombra ese vehículo, aunque nombre un turno", () => {
  const auto = llamada("reserve_vehicle", {
    ok: true,
    data: { vehiculo: "Renault Kwid Zen 2021", yaEstabaReservada: false },
  });
  const frase =
    "Listo: el Kwid quedó reservado y la prueba de manejo quedó confirmada para el lunes.";
  assert.deepEqual(afirmacionesSinRespaldo(frase, [auto]), []);
  // Sin el reserve_vehicle, la misma oración no sale.
  assert.deepEqual(afirmacionesSinRespaldo(frase, []), ["AGENDAR"]);
  // Un reserve_vehicle fallido no respalda nada.
  const fallido = llamada("reserve_vehicle", { ok: false, error: "No hay ninguna unidad" });
  assert.deepEqual(afirmacionesSinRespaldo(frase, [fallido]), ["AGENDAR"]);
  // Otro vehículo no respalda el turno.
  assert.deepEqual(
    afirmacionesSinRespaldo("Te reservé el test drive del Onix para el lunes.", [auto]),
    ["AGENDAR"],
  );
});

// Tercer falso positivo (eval con anthropic/claude-haiku-5.5, 2026-11-22): el
// turno se creó en un mensaje anterior y el modelo lo vuelve a confirmar.
// Con un turno futuro que coincide, pasa; con una hora o un día que no
// coincide con ninguno, la guarda actúa igual (decisión de Rocco).
test("un turno que ya existe respalda la afirmación de agendar, salvo que la hora o el día no coincidan", () => {
  const ZONA = "America/Montevideo";
  // Lunes 23/11/2026 a las 10:00 en Montevideo (UTC-3).
  const turnos = { inicios: [new Date("2026-11-23T13:00:00.000Z")], zona: ZONA };
  const real =
    "Rodrigo, ya quedó reservada: la prueba de manejo del Renault Kwid Zen 2021 es el lunes 23 de noviembre de 10:00 a 10:30. Acordate de traer la libreta de conducir.";
  assert.deepEqual(afirmacionesSinRespaldo(real, [], turnos), []);
  // Sin turnos (o sin el dato), como antes.
  assert.deepEqual(afirmacionesSinRespaldo(real, [], { inicios: [], zona: ZONA }), ["AGENDAR"]);
  assert.deepEqual(afirmacionesSinRespaldo(real, []), ["AGENDAR"]);
  // La variante con la hora equivocada: no coincide con ningún turno.
  const horaEquivocada =
    "Rodrigo, ya quedó reservada: la prueba de manejo del Renault Kwid Zen 2021 es el lunes 23 de noviembre a las 11:00.";
  assert.deepEqual(afirmacionesSinRespaldo(horaEquivocada, [], turnos), ["AGENDAR"]);
  // El día equivocado, con la hora bien.
  assert.deepEqual(
    afirmacionesSinRespaldo("Tu turno quedó agendado para el martes 24 a las 10:00.", [], turnos),
    ["AGENDAR"],
  );
  // Sin hora ni día: alcanza con que tenga un turno.
  assert.deepEqual(afirmacionesSinRespaldo("Tu turno quedó agendado.", [], turnos), []);
  // "9:40" sin cero adelante coincide con un turno de las 09:40.
  assert.equal(
    coincideConUnTurnoExistente("el turno quedó agendado a las 9:40", {
      inicios: [new Date("2026-11-27T12:40:00.000Z")],
      zona: ZONA,
    }),
    true,
  );
  // Reprogramar o cancelar no se respaldan con un turno existente.
  assert.deepEqual(afirmacionesSinRespaldo("Tu turno quedó cancelado.", [], turnos), ["CANCELAR"]);
});
