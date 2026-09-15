import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDaysUTC,
  addWeeksUTC,
  dateKeyUTC,
  dayWindowUTC,
  lastDaysUTC,
  lastWeeksUTC,
  startOfDayUTC,
  startOfNextDayUTC,
  startOfNextWeekUTC,
  startOfWeekUTC,
  weekWindowUTC,
} from "./utcWindow";

// Mismo espíritu que utcMonth.test.ts: instantes elegidos para que la hora
// local y la UTC caigan en días distintos si alguien cambiara Date.UTC por
// new Date(y, m, d). El 15 de marzo de 2026 es domingo, así que su semana
// (lunes a domingo) arranca el 9.
const DOMINGO_DE_NOCHE = new Date("2026-03-15T23:30:00.000Z");

test("startOfDayUTC: medianoche UTC del mismo día, sin importar la hora", () => {
  assert.equal(startOfDayUTC(DOMINGO_DE_NOCHE).toISOString(), "2026-03-15T00:00:00.000Z");
  assert.equal(
    startOfDayUTC(new Date("2026-03-15T00:00:00.000Z")).toISOString(),
    "2026-03-15T00:00:00.000Z",
    "el primer instante del día es su propio inicio",
  );
});

test("addDaysUTC / startOfNextDayUTC cruzan el mes y el año", () => {
  assert.equal(
    addDaysUTC(new Date("2026-02-28T00:00:00.000Z"), 1).toISOString(),
    "2026-03-01T00:00:00.000Z",
    "2026 no es bisiesto",
  );
  assert.equal(
    addDaysUTC(new Date("2024-02-28T00:00:00.000Z"), 1).toISOString(),
    "2024-02-29T00:00:00.000Z",
    "2024 sí lo es",
  );
  assert.equal(
    startOfNextDayUTC(new Date("2026-12-31T18:00:00.000Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
  assert.equal(
    addDaysUTC(new Date("2026-01-01T00:00:00.000Z"), -1).toISOString(),
    "2025-12-31T00:00:00.000Z",
  );
});

test("startOfWeekUTC: el lunes de esa semana, y un lunes es su propio inicio", () => {
  // Domingo 15 → lunes 9.
  assert.equal(startOfWeekUTC(DOMINGO_DE_NOCHE).toISOString(), "2026-03-09T00:00:00.000Z");
  // Lunes 9 a cualquier hora → lunes 9.
  assert.equal(
    startOfWeekUTC(new Date("2026-03-09T23:59:59.999Z")).toISOString(),
    "2026-03-09T00:00:00.000Z",
  );
  // El primer instante del lunes ya es el inicio.
  assert.equal(
    startOfWeekUTC(new Date("2026-03-09T00:00:00.000Z")).toISOString(),
    "2026-03-09T00:00:00.000Z",
  );
  // Y el domingo anterior pertenece a la semana anterior, no a ésta.
  assert.equal(
    startOfWeekUTC(new Date("2026-03-08T12:00:00.000Z")).toISOString(),
    "2026-03-02T00:00:00.000Z",
  );
});

test("addWeeksUTC / startOfNextWeekUTC se mueven de a siete días", () => {
  assert.equal(
    addWeeksUTC(new Date("2026-03-09T00:00:00.000Z"), 2).toISOString(),
    "2026-03-23T00:00:00.000Z",
  );
  assert.equal(
    addWeeksUTC(new Date("2026-01-05T00:00:00.000Z"), -1).toISOString(),
    "2025-12-29T00:00:00.000Z",
    "cruza el año",
  );
  assert.equal(
    startOfNextWeekUTC(DOMINGO_DE_NOCHE).toISOString(),
    "2026-03-16T00:00:00.000Z",
    "la semana siguiente al domingo 15 arranca el lunes 16",
  );
});

test("dateKeyUTC: YYYY-MM-DD, siempre en UTC", () => {
  assert.equal(dateKeyUTC(new Date("2026-03-09T00:00:00.000Z")), "2026-03-09");
  assert.equal(
    dateKeyUTC(new Date("2026-03-31T23:30:00.000Z")),
    "2026-03-31",
    "la hora no corre el día",
  );
});

test("dayWindowUTC: ventana [medianoche, medianoche siguiente) con su rótulo", () => {
  const hoy = dayWindowUTC(DOMINGO_DE_NOCHE);
  assert.deepEqual(
    { label: hoy.label, start: hoy.start.toISOString(), end: hoy.end.toISOString() },
    {
      label: "2026-03-15",
      start: "2026-03-15T00:00:00.000Z",
      end: "2026-03-16T00:00:00.000Z",
    },
  );

  const ayer = dayWindowUTC(DOMINGO_DE_NOCHE, -1);
  assert.equal(ayer.label, "2026-03-14");
  assert.equal(ayer.end.getTime(), hoy.start.getTime());
});

test("weekWindowUTC: ventana [lunes, lunes siguiente) rotulada con el lunes", () => {
  const actual = weekWindowUTC(DOMINGO_DE_NOCHE);
  assert.deepEqual(
    { label: actual.label, start: actual.start.toISOString(), end: actual.end.toISOString() },
    {
      label: "2026-03-09",
      start: "2026-03-09T00:00:00.000Z",
      end: "2026-03-16T00:00:00.000Z",
    },
  );

  const anterior = weekWindowUTC(DOMINGO_DE_NOCHE, -1);
  assert.equal(anterior.label, "2026-03-02");
  assert.equal(anterior.end.getTime(), actual.start.getTime());
});

test("lastDaysUTC: exactamente N ventanas contiguas, cronológicas, la de hoy al final", () => {
  const ventanas = lastDaysUTC(DOMINGO_DE_NOCHE, 30);
  assert.equal(ventanas.length, 30);
  assert.equal(ventanas[0].label, "2026-02-14", "30 días atrás, cruzando el mes");
  assert.equal(ventanas[29].label, "2026-03-15");
  for (let i = 1; i < ventanas.length; i += 1) {
    assert.equal(
      ventanas[i].start.getTime(),
      ventanas[i - 1].end.getTime(),
      "cada ventana empieza exactamente donde termina la anterior: sin huecos ni solapes",
    );
  }
});

test("lastWeeksUTC: exactamente N semanas contiguas, la en curso al final", () => {
  const ventanas = lastWeeksUTC(DOMINGO_DE_NOCHE, 8);
  assert.deepEqual(
    ventanas.map((v) => v.label),
    [
      "2026-01-19",
      "2026-01-26",
      "2026-02-02",
      "2026-02-09",
      "2026-02-16",
      "2026-02-23",
      "2026-03-02",
      "2026-03-09",
    ],
    "la semana del domingo 15 es la que arranca el lunes 9, y va última",
  );
  for (let i = 1; i < ventanas.length; i += 1) {
    assert.equal(ventanas[i].start.getTime(), ventanas[i - 1].end.getTime());
  }
});
