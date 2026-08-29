import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularTurnos } from "./availability.service";
import type { Intervalo } from "../utils/workingHours";

// Unitarios, sin base y sin red: calcularTurnos() es puro a propósito. Acá vive
// la aritmética que decide QUÉ HORARIOS SE LE OFRECEN A UN CLIENTE, y no
// debería hacer falta un Postgres ni un Google para verificarla.
//
// La cuenta que se prueba: horario de trabajo MENOS lo ocupado en Google MENOS
// el cupo ya tomado por reservas propias.

// Lunes 7/9/2026, de 9 a 13 hora de Buenos Aires = 12:00Z a 16:00Z.
const MANANA: Intervalo = {
  inicio: new Date("2026-09-07T12:00:00Z"),
  fin: new Date("2026-09-07T16:00:00Z"),
};

// 16 a 20 local = 19:00Z a 23:00Z.
const TARDE: Intervalo = {
  inicio: new Date("2026-09-07T19:00:00Z"),
  fin: new Date("2026-09-07T23:00:00Z"),
};

function intervalo(inicioIso: string, finIso: string): Intervalo {
  return { inicio: new Date(inicioIso), fin: new Date(finIso) };
}

function inicios(turnos: { inicio: Date }[]): string[] {
  return turnos.map((t) => t.inicio.toISOString());
}

const BASE = {
  franjasDeTrabajo: [MANANA],
  ocupadosEnGoogle: [],
  reservasConfirmadas: [],
  duracionMin: 60,
  capacidad: 1,
};

// ---------------------------------------------------------------------------
// La grilla
// ---------------------------------------------------------------------------

test("una franja de 4 horas con turnos de 60 minutos da 4 turnos consecutivos", () => {
  const turnos = calcularTurnos(BASE);

  assert.deepEqual(inicios(turnos), [
    "2026-09-07T12:00:00.000Z",
    "2026-09-07T13:00:00.000Z",
    "2026-09-07T14:00:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);
  assert.equal(turnos[3].fin.toISOString(), "2026-09-07T16:00:00.000Z", "el último cierra justo");
});

test("un turno que NO entra entero en la franja no se ofrece", () => {
  // Franja de 4 horas, turnos de 90 minutos: entran dos (12:00 y 13:30) y el
  // tercero terminaría 16:30, pasado el cierre. Ofrecerlo sería ofrecer un
  // horario que después POST /api/bookings rechaza.
  const turnos = calcularTurnos({ ...BASE, duracionMin: 90 });

  assert.deepEqual(inicios(turnos), ["2026-09-07T12:00:00.000Z", "2026-09-07T13:30:00.000Z"]);
});

test("un servicio más largo que la franja no produce ningún turno", () => {
  assert.deepEqual(calcularTurnos({ ...BASE, duracionMin: 300 }), []);
});

test("sin horario de trabajo no hay disponibilidad, y eso no es un error", () => {
  assert.deepEqual(calcularTurnos({ ...BASE, franjasDeTrabajo: [] }), []);
});

test("el horario partido produce turnos en las DOS franjas y ninguno en el hueco", () => {
  const turnos = calcularTurnos({ ...BASE, franjasDeTrabajo: [MANANA, TARDE] });

  assert.equal(turnos.length, 8, "4 de mañana + 4 de tarde");

  // Nada entre las 16:00Z (cierre de la mañana) y las 19:00Z (apertura de la
  // tarde): la grilla arranca en el borde de CADA franja, no atraviesa el hueco.
  const enElHueco = turnos.filter(
    (t) =>
      t.inicio >= new Date("2026-09-07T16:00:00Z") && t.inicio < new Date("2026-09-07T19:00:00Z"),
  );
  assert.deepEqual(enElHueco, []);

  assert.equal(inicios(turnos)[4], "2026-09-07T19:00:00.000Z", "la tarde arranca en su borde");
});

// ---------------------------------------------------------------------------
// La resta de Google
// ---------------------------------------------------------------------------

test("un evento en Google elimina el turno que se superpone", () => {
  const turnos = calcularTurnos({
    ...BASE,
    ocupadosEnGoogle: [intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z")],
  });

  assert.deepEqual(inicios(turnos), [
    "2026-09-07T12:00:00.000Z",
    "2026-09-07T14:00:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);
});

test("un evento de Google que se pisa PARCIALMENTE también elimina el turno", () => {
  // Evento de 13:30 a 13:45: no coincide con ningún turno de la grilla, pero se
  // mete dentro del de 13:00. Si solo se compararan horarios exactos, el sistema
  // ofrecería un turno encima de un evento real del calendario del negocio.
  const turnos = calcularTurnos({
    ...BASE,
    ocupadosEnGoogle: [intervalo("2026-09-07T13:30:00Z", "2026-09-07T13:45:00Z")],
  });

  assert.ok(!inicios(turnos).includes("2026-09-07T13:00:00.000Z"));
  assert.equal(turnos.length, 3);
});

test("un evento de Google ADYACENTE no elimina nada", () => {
  // Evento de 11:00 a 12:00, justo antes de abrir. El fin es exclusivo, así que
  // el turno de 12:00 sigue disponible.
  const turnos = calcularTurnos({
    ...BASE,
    ocupadosEnGoogle: [intervalo("2026-09-07T11:00:00Z", "2026-09-07T12:00:00Z")],
  });

  assert.equal(turnos.length, 4);
  assert.equal(inicios(turnos)[0], "2026-09-07T12:00:00.000Z");
});

test("Google descarta el turno SIN IMPORTAR la capacidad", () => {
  // Una clase con 20 lugares y un evento ajeno encima: el recurso no está, y eso
  // no se comparte entre cupos. Es la diferencia entre la resta de Google y la
  // resta de reservas propias.
  const turnos = calcularTurnos({
    ...BASE,
    capacidad: 20,
    ocupadosEnGoogle: [intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z")],
  });

  assert.ok(!inicios(turnos).includes("2026-09-07T13:00:00.000Z"));
});

// ---------------------------------------------------------------------------
// La capacidad — lo que Google NO puede resolver
// ---------------------------------------------------------------------------

test("con capacidad 1, una reserva propia elimina el turno", () => {
  const turnos = calcularTurnos({
    ...BASE,
    reservasConfirmadas: [intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z")],
  });

  assert.deepEqual(inicios(turnos), [
    "2026-09-07T12:00:00.000Z",
    "2026-09-07T14:00:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);
});

test("con capacidad 20, UNA inscripción NO llena la clase", () => {
  // ES EL CASO QUE JUSTIFICA QUE LA CAPACIDAD VIVA EN EL CRM Y NO EN GOOGLE. En
  // Google, la clase de yoga aparece OCUPADA desde el primer inscripto — si solo
  // restáramos Google, una clase con un alumno se vería llena.
  const turnos = calcularTurnos({
    ...BASE,
    capacidad: 20,
    reservasConfirmadas: [intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z")],
  });

  assert.equal(turnos.length, 4, "el turno sigue disponible");

  const conInscripto = turnos.find((t) => t.inicio.toISOString() === "2026-09-07T13:00:00.000Z");
  assert.equal(conInscripto?.lugaresDisponibles, 19);
});

test("cuando se llena el cupo, el turno desaparece", () => {
  const reservas = Array.from({ length: 3 }, () =>
    intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z"),
  );

  const turnos = calcularTurnos({ ...BASE, capacidad: 3, reservasConfirmadas: reservas });

  assert.ok(!inicios(turnos).includes("2026-09-07T13:00:00.000Z"));
  assert.equal(turnos.length, 3);
});

test("lugaresDisponibles refleja el cupo restante", () => {
  const turnos = calcularTurnos({
    ...BASE,
    capacidad: 5,
    reservasConfirmadas: [
      intervalo("2026-09-07T12:00:00Z", "2026-09-07T13:00:00Z"),
      intervalo("2026-09-07T12:00:00Z", "2026-09-07T13:00:00Z"),
    ],
  });

  assert.equal(turnos[0].lugaresDisponibles, 3, "5 - 2");
  assert.equal(turnos[1].lugaresDisponibles, 5, "el siguiente está vacío");
});

test("con capacidad 1 todo turno ofrecido tiene exactamente 1 lugar", () => {
  // Si estuviera tomado, no aparecería. La aserción existe para que
  // lugaresDisponibles no devuelva 0 en un turno visible, que sería contradictorio.
  for (const turno of calcularTurnos(BASE)) {
    assert.equal(turno.lugaresDisponibles, 1);
  }
});

test("una reserva que se pisa parcialmente también consume cupo", () => {
  // Reserva de 13:30 a 14:30: toca el turno de 13:00 y el de 14:00. Con
  // capacidad 1 elimina los dos — dos turnos que se pisan compiten por el mismo
  // recurso aunque no empiecen a la misma hora.
  const turnos = calcularTurnos({
    ...BASE,
    reservasConfirmadas: [intervalo("2026-09-07T13:30:00Z", "2026-09-07T14:30:00Z")],
  });

  assert.deepEqual(inicios(turnos), ["2026-09-07T12:00:00.000Z", "2026-09-07T15:00:00.000Z"]);
});

test("una reserva fuera del rango de la franja no afecta nada", () => {
  const turnos = calcularTurnos({
    ...BASE,
    reservasConfirmadas: [intervalo("2026-09-07T20:00:00Z", "2026-09-07T21:00:00Z")],
  });

  assert.equal(turnos.length, 4);
});

// ---------------------------------------------------------------------------
// Las tres restas juntas
// ---------------------------------------------------------------------------

test("Google y las reservas propias se restan a la vez", () => {
  const turnos = calcularTurnos({
    franjasDeTrabajo: [MANANA],
    ocupadosEnGoogle: [intervalo("2026-09-07T12:00:00Z", "2026-09-07T13:00:00Z")],
    reservasConfirmadas: [intervalo("2026-09-07T14:00:00Z", "2026-09-07T15:00:00Z")],
    duracionMin: 60,
    capacidad: 1,
  });

  // 12:00 lo saca Google, 14:00 lo saca la reserva propia. Quedan 13:00 y 15:00.
  assert.deepEqual(inicios(turnos), ["2026-09-07T13:00:00.000Z", "2026-09-07T15:00:00.000Z"]);
});

// ---------------------------------------------------------------------------
// A-5 (docs/auditoria-2026-08-29.md) — la grilla se ancla en el borde REAL de
// la franja, y `desde` solo FILTRA.
//
// El escenario del hallazgo: mismo horario, misma reserva existente, dos
// consultas con `from` distinto dentro del mismo día. Tienen que devolver LA
// MISMA grilla (los mismos inicios de turno); la segunda solo tiene menos
// turnos al principio. Nunca turnos corridos ni huecos distintos.
// ---------------------------------------------------------------------------

test("A-5: dos consultas con `desde` distinto ven la MISMA grilla, la segunda con menos turnos al principio", () => {
  const reservaExistente = intervalo("2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z");
  const entrada = { ...BASE, reservasConfirmadas: [reservaExistente] };

  // Consulta A: desde el inicio del día.
  const desdeElInicio = calcularTurnos({ ...entrada, desde: new Date("2026-09-07T00:00:00Z") });
  // Consulta B: "a partir de ahora", diez minutos después de abrir.
  const desdeLas9y10 = calcularTurnos({ ...entrada, desde: new Date("2026-09-07T12:10:00Z") });

  assert.deepEqual(inicios(desdeElInicio), [
    "2026-09-07T12:00:00.000Z",
    "2026-09-07T14:00:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);

  // Con el bug, la franja llegaba recortada a 12:10 y la grilla salía 12:10,
  // 13:10, 14:10, 15:10 — 12:10 y 13:10 chocaban con la reserva de 13:00, y el
  // resultado era ["14:10"]: un turno que no existe en la grilla real, y un
  // hueco de más.
  assert.deepEqual(
    inicios(desdeLas9y10),
    ["2026-09-07T14:00:00.000Z", "2026-09-07T15:00:00.000Z"],
    "la grilla es la misma; solo falta el turno de 12:00, que ya empezó",
  );

  // La propiedad general: todo inicio de B es un inicio de A.
  for (const inicio of inicios(desdeLas9y10)) {
    assert.ok(inicios(desdeElInicio).includes(inicio), `${inicio} no está en la grilla real`);
  }
});

test("A-5: un turno que ya EMPEZÓ antes de `desde` no se ofrece, aunque termine después", () => {
  // Son las 12:30Z: el turno de 12:00-13:00 va por la mitad. No se ofrece — y
  // tampoco se corre para que empiece a las 12:30, que era el bug.
  const turnos = calcularTurnos({ ...BASE, desde: new Date("2026-09-07T12:30:00Z") });

  assert.deepEqual(inicios(turnos), [
    "2026-09-07T13:00:00.000Z",
    "2026-09-07T14:00:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);
});

test("A-5: un `desde` que coincide con el inicio de un turno lo incluye (el filtro es `inicio < desde`)", () => {
  const turnos = calcularTurnos({ ...BASE, desde: new Date("2026-09-07T13:00:00Z") });
  assert.equal(inicios(turnos)[0], "2026-09-07T13:00:00.000Z");
});

test("A-5: sin `desde` no se filtra nada (la firma vieja sigue valiendo)", () => {
  assert.equal(calcularTurnos(BASE).length, 4);
});

test("los turnos salen en orden cronológico", () => {
  const turnos = calcularTurnos({ ...BASE, franjasDeTrabajo: [MANANA, TARDE] });

  for (let i = 1; i < turnos.length; i++) {
    assert.ok(
      turnos[i - 1].inicio <= turnos[i].inicio,
      "la agenda tiene que salir ordenada para poder mostrarse tal cual",
    );
  }
});
