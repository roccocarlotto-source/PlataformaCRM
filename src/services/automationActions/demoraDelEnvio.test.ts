import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  MAX_DELAY_HOURS,
  MAX_DELAY_MINUTES,
  camposDeLaDemora,
  demoraEnMinutos,
  horaDeEnvio,
  validarDemora,
} from "./demoraDelEnvio";

// ---------------------------------------------------------------------------
// La demora de las reglas del QR y del cupón: delayMinutes, o delayHours en
// una regla guardada antes de que existieran los minutos. Se prueba con un
// schema mínimo armado igual que los de las dos acciones; que cada acción la
// use se prueba en sus propios tests.
// ---------------------------------------------------------------------------

const schema = z
  .object({ ...camposDeLaDemora })
  .superRefine(validarDemora)
  .transform(demoraEnMinutos);

function mensajesDe(config: unknown): string {
  const resultado = schema.safeParse(config);
  assert.equal(resultado.success, false, JSON.stringify(config));
  return resultado.error?.issues.map((i) => i.message).join(", ") ?? "";
}

test("el tope son 30 días en las dos unidades", () => {
  assert.equal(MAX_DELAY_MINUTES, 43200);
  assert.equal(MAX_DELAY_HOURS, 720);
});

test("delayMinutes pasa tal cual, con sus bordes", () => {
  assert.deepEqual(schema.parse({ delayMinutes: 0 }), { delayMinutes: 0 });
  assert.deepEqual(schema.parse({ delayMinutes: 15 }), { delayMinutes: 15 });
  assert.deepEqual(schema.parse({ delayMinutes: MAX_DELAY_MINUTES }), {
    delayMinutes: MAX_DELAY_MINUTES,
  });
});

test("una regla vieja con delayHours se lee en minutos y pierde la clave legada", () => {
  assert.deepEqual(schema.parse({ delayHours: 0 }), { delayMinutes: 0 });
  assert.deepEqual(schema.parse({ delayHours: 24 }), { delayMinutes: 1440 });
  assert.deepEqual(schema.parse({ delayHours: MAX_DELAY_HOURS }), {
    delayMinutes: MAX_DELAY_MINUTES,
  });
});

test("el resto del config sobrevive a la conversión", () => {
  assert.deepEqual(demoraEnMinutos({ qrCodeId: "x", delayHours: 2 }), {
    qrCodeId: "x",
    delayMinutes: 120,
  });
  assert.deepEqual(demoraEnMinutos({ qrCodeId: "x", delayMinutes: 5 }), {
    qrCodeId: "x",
    delayMinutes: 5,
  });
});

test("sin ninguna de las dos es requerida; con las dos, ambigua", () => {
  assert.match(mensajesDe({}), /delayMinutes es requerido/);
  assert.match(mensajesDe({ delayMinutes: 30, delayHours: 1 }), /no los dos/);
});

test("cada valor fuera de rango se rechaza con un mensaje que nombra la clave", () => {
  const casos: [unknown, RegExp][] = [
    [{ delayMinutes: -1 }, /delayMinutes no puede ser negativo/],
    [{ delayMinutes: 1.5 }, /delayMinutes debe ser un número entero/],
    [{ delayMinutes: "15" }, /delayMinutes debe ser un número entero/],
    [{ delayMinutes: MAX_DELAY_MINUTES + 1 }, /delayMinutes no puede superar los 43200 minutos/],
    [{ delayHours: -1 }, /delayHours no puede ser negativo/],
    [{ delayHours: 1.5 }, /delayHours debe ser un número entero/],
    [{ delayHours: MAX_DELAY_HOURS + 1 }, /delayHours no puede superar las 720 horas/],
  ];
  for (const [config, mensaje] of casos) {
    assert.match(mensajesDe(config), mensaje, JSON.stringify(config));
  }
});

test("horaDeEnvio suma minutos exactos", () => {
  const ahora = new Date("2026-09-25T15:00:00.000Z");
  assert.equal(horaDeEnvio(ahora, 0).toISOString(), "2026-09-25T15:00:00.000Z");
  assert.equal(horaDeEnvio(ahora, 15).toISOString(), "2026-09-25T15:15:00.000Z");
  assert.equal(horaDeEnvio(ahora, 48 * 60).toISOString(), "2026-09-27T15:00:00.000Z");
});
