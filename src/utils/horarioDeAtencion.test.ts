import assert from "node:assert/strict";
import { test } from "node:test";
import { HORARIO_POR_DEFECTO, proximoMomentoParaEnviar } from "./horarioDeAtencion";
import type { FranjaSemanal } from "./workingHours";

// G-07 de docs-privados/auditoria-2026-09-30-corta.md (local): la ventana de
// envío de los mensajes que inicia el negocio. Montevideo es UTC-3 todo el
// año (sin horario de verano), así que las horas locales se leen directo.
const ZONA = "America/Montevideo";

// 2026-10-05 es lunes.
const local = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);

test("G-07: el horario por defecto es lunes a sábado de 9 a 20", () => {
  assert.equal(HORARIO_POR_DEFECTO.length, 6);
  assert.ok(HORARIO_POR_DEFECTO.every((f) => f.startMinute === 540 && f.endMinute === 1200));
  assert.ok(!HORARIO_POR_DEFECTO.some((f) => f.weekday === "SUNDAY"));
});

test("G-07: dentro del horario sale ahora", () => {
  const ahora = local("2026-10-05", "15:30");
  assert.equal(proximoMomentoParaEnviar([], ZONA, ahora).getTime(), ahora.getTime());
});

test("G-07: de madrugada se corre a la apertura del mismo día", () => {
  const ahora = local("2026-10-05", "04:00");
  assert.equal(
    proximoMomentoParaEnviar([], ZONA, ahora).toISOString(),
    local("2026-10-05", "09:00").toISOString(),
  );
});

test("G-07: a la hora de cierre ya está cerrado (fin exclusivo) y pasa al día siguiente", () => {
  assert.equal(
    proximoMomentoParaEnviar([], ZONA, local("2026-10-05", "20:00")).toISOString(),
    local("2026-10-06", "09:00").toISOString(),
  );
});

test("G-07: el sábado a la noche con el default pasa al lunes (domingo cerrado)", () => {
  // 2026-10-10 es sábado.
  assert.equal(
    proximoMomentoParaEnviar([], ZONA, local("2026-10-10", "21:00")).toISOString(),
    local("2026-10-12", "09:00").toISOString(),
  );
});

test("G-07: con horario propio usa ese y no el default, incluido el corte del mediodía", () => {
  const franjas: FranjaSemanal[] = [
    { weekday: "MONDAY", startMinute: 10 * 60, endMinute: 13 * 60 },
    { weekday: "MONDAY", startMinute: 16 * 60, endMinute: 19 * 60 },
    { weekday: "SUNDAY", startMinute: 10 * 60, endMinute: 12 * 60 },
  ];
  // Lunes 14:00: entre las dos franjas → 16:00.
  assert.equal(
    proximoMomentoParaEnviar(franjas, ZONA, local("2026-10-05", "14:00")).toISOString(),
    local("2026-10-05", "16:00").toISOString(),
  );
  // Lunes 11:00: abierto.
  const once = local("2026-10-05", "11:00");
  assert.equal(proximoMomentoParaEnviar(franjas, ZONA, once).getTime(), once.getTime());
  // Lunes 19:30: la próxima es el domingo a las 10.
  assert.equal(
    proximoMomentoParaEnviar(franjas, ZONA, local("2026-10-05", "19:30")).toISOString(),
    local("2026-10-11", "10:00").toISOString(),
  );
});

test("G-07: el día de la semana es el de la sucursal, no el de UTC", () => {
  // Domingo 22:00 en Montevideo = lunes 01:00 UTC. Con el default el domingo
  // está cerrado, así que sale el lunes a las 9 LOCALES, no "ya es lunes".
  assert.equal(
    proximoMomentoParaEnviar([], ZONA, local("2026-10-11", "22:00")).toISOString(),
    local("2026-10-12", "09:00").toISOString(),
  );
});
