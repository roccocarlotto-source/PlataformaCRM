import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMonthsUTC,
  lastMonthsUTC,
  monthKeyUTC,
  monthWindowUTC,
  startOfMonthUTC,
  startOfNextMonthUTC,
  startOfPreviousMonthUTC,
} from "./utcMonth";

// Instantes elegidos para que la hora local y la UTC caigan en meses
// distintos si alguien cambiara Date.UTC por new Date(y, m, 1): el 31 a las
// 23:30 UTC es "1 del mes siguiente" en cualquier zona al este de UTC.
const FIN_DE_MARZO = new Date("2026-03-31T23:30:00.000Z");

test("startOfMonthUTC: medianoche UTC del día 1, sin importar la hora ni el día", () => {
  assert.equal(startOfMonthUTC(FIN_DE_MARZO).toISOString(), "2026-03-01T00:00:00.000Z");
  assert.equal(
    startOfMonthUTC(new Date("2026-03-01T00:00:00.000Z")).toISOString(),
    "2026-03-01T00:00:00.000Z",
    "el primer instante del mes es su propio inicio",
  );
});

test("startOfNextMonthUTC / startOfPreviousMonthUTC cruzan el año", () => {
  assert.equal(
    startOfNextMonthUTC(new Date("2026-12-15T12:00:00.000Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
  assert.equal(
    startOfPreviousMonthUTC(new Date("2026-01-15T12:00:00.000Z")).toISOString(),
    "2025-12-01T00:00:00.000Z",
  );
});

test("addMonthsUTC normaliza meses fuera de rango en los dos sentidos", () => {
  const enero = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(addMonthsUTC(enero, 12).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(addMonthsUTC(enero, -1).toISOString(), "2025-12-01T00:00:00.000Z");
  assert.equal(addMonthsUTC(enero, -13).toISOString(), "2024-12-01T00:00:00.000Z");
});

test("monthKeyUTC: YYYY-MM con el mes a dos dígitos", () => {
  assert.equal(monthKeyUTC(new Date("2026-03-31T23:30:00.000Z")), "2026-03");
  assert.equal(monthKeyUTC(new Date("2026-11-01T00:00:00.000Z")), "2026-11");
});

test("monthWindowUTC: ventana [inicio del mes, inicio del siguiente) con su rótulo", () => {
  const actual = monthWindowUTC(FIN_DE_MARZO);
  assert.deepEqual(
    { month: actual.month, start: actual.start.toISOString(), end: actual.end.toISOString() },
    { month: "2026-03", start: "2026-03-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
  );

  const anterior = monthWindowUTC(FIN_DE_MARZO, -1);
  assert.deepEqual(
    {
      month: anterior.month,
      start: anterior.start.toISOString(),
      end: anterior.end.toISOString(),
    },
    { month: "2026-02", start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" },
  );
});

test("lastMonthsUTC: exactamente N ventanas contiguas, cronológicas, la actual al final", () => {
  const ventanas = lastMonthsUTC(FIN_DE_MARZO, 6);
  assert.deepEqual(
    ventanas.map((w) => w.month),
    ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
  );
  for (let i = 1; i < ventanas.length; i += 1) {
    assert.equal(
      ventanas[i].start.getTime(),
      ventanas[i - 1].end.getTime(),
      "cada ventana empieza exactamente donde termina la anterior: sin huecos ni solapes",
    );
  }
});
