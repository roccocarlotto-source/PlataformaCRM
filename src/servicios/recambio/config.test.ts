import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIG_DEL_RECAMBIO_POR_DEFECTO,
  asuntoDelRecambio,
  comprasPosibles,
  configDelRecambioSchema,
  fechaDeAviso,
  fechaDeRecambio,
  laFechaDeAvisoCae,
  sumarDias,
} from "./config";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

test("config: defaults 48 meses y 60 días; topes 12–120 y 0–180", () => {
  assert.deepEqual(configDelRecambioSchema.parse({}), CONFIG_DEL_RECAMBIO_POR_DEFECTO);
  assert.deepEqual(configDelRecambioSchema.parse({ monthsAfterPurchase: 36, daysBefore: 0 }), {
    monthsAfterPurchase: 36,
    daysBefore: 0,
  });
  for (const malo of [
    { monthsAfterPurchase: 11 },
    { monthsAfterPurchase: 121 },
    { daysBefore: -1 },
    { daysBefore: 181 },
    { monthsAfterPurchase: 48.5 },
  ]) {
    assert.equal(configDelRecambioSchema.safeParse(malo).success, false, JSON.stringify(malo));
  }
});

test("fechas: recambio = compra + meses (sin correrse de día), aviso = recambio − días", () => {
  const c = CONFIG_DEL_RECAMBIO_POR_DEFECTO;
  assert.equal(iso(fechaDeRecambio(dia("2022-10-15"), c)), "2026-10-15");
  assert.equal(iso(fechaDeAviso(dia("2022-10-15"), c)), "2026-08-16");
  // Fin de mes: el último día del mes.
  assert.equal(iso(fechaDeRecambio(dia("2024-02-29"), c)), "2028-02-29");
  assert.equal(
    iso(fechaDeRecambio(dia("2023-01-31"), { monthsAfterPurchase: 13, daysBefore: 0 })),
    "2024-02-29",
  );
});

test("ventana: el aviso cae en [hoy − 7, hoy], y comprasPosibles la cubre con margen", () => {
  const c = CONFIG_DEL_RECAMBIO_POR_DEFECTO;
  const hoy = dia("2026-08-16");
  assert.equal(laFechaDeAvisoCae(dia("2022-10-15"), hoy, c), true, "el aviso es hoy");
  assert.equal(laFechaDeAvisoCae(dia("2022-10-08"), hoy, c), true, "hace 7 días");
  assert.equal(laFechaDeAvisoCae(dia("2022-10-07"), hoy, c), false, "hace 8");
  assert.equal(laFechaDeAvisoCae(dia("2022-10-16"), hoy, c), false, "mañana");
  // Toda compra cuyo aviso cae está dentro del rango a buscar.
  const { desde, hasta } = comprasPosibles(hoy, c);
  for (let i = -10; i <= 10; i++) {
    const compra = sumarDias(dia("2022-10-15"), i);
    if (laFechaDeAvisoCae(compra, hoy, c)) {
      assert.ok(compra >= desde && compra <= hasta, iso(compra));
    }
  }
});

test("el título de la tarea de §7.3", () => {
  assert.equal(
    asuntoDelRecambio("Ana Pérez", "Fiat Uno (ABC 1234)", dia("2022-10-15")),
    "Contactar a Ana Pérez: se acerca el recambio de su Fiat Uno (ABC 1234) (comprado el 15/10/2022)",
  );
});
