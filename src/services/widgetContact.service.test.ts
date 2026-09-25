import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES,
  crearTopeDeContactosNuevos,
  fechaDeCorteDeVisitantes,
} from "./widgetContact.service";

// ---------------------------------------------------------------------------
// Ítem 138 (B-10/F-05). Unitarios, sin base: el tope de contactos nuevos por
// token y la fecha de corte de la purga. Qué contactos entran en la purga se
// prueba contra Postgres en widgetVisitorsPurge.integration-test.ts.
// ---------------------------------------------------------------------------

function esUn429(err: unknown) {
  return err instanceof AppError && err.statusCode === 429;
}

test("el tope de contactos nuevos corta con 429 al superarlo, por token, y se libera al cerrar la ventana", () => {
  let t = 0;
  const consumir = crearTopeDeContactosNuevos({ windowMs: 1000, max: 2, ahora: () => t });

  consumir("tok-a");
  consumir("tok-a");
  assert.throws(() => consumir("tok-a"), esUn429);
  // El rechazado no suma: sigue cortando igual, sin correr la ventana.
  assert.throws(() => consumir("tok-a"), esUn429);

  // Otro token tiene su propio cupo.
  consumir("tok-b");

  // Justo antes del cierre sigue cortado; al cerrar, cupo nuevo.
  t = 999;
  assert.throws(() => consumir("tok-a"), esUn429);
  t = 1000;
  consumir("tok-a");
});

test("el corte de la purga es DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES días antes de ahora", () => {
  const ahora = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES, 7);
  assert.equal(fechaDeCorteDeVisitantes(ahora).toISOString(), "2026-09-18T12:00:00.000Z");
});
