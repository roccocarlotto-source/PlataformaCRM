import assert from "node:assert/strict";
import { test } from "node:test";
import { countRawHeaderOccurrences } from "./rawHeaders";

// B-25 — el helper es puro y se testea con arrays armados a mano, con la
// misma forma plana [nombre, valor, nombre, valor, ...] que expone
// IncomingMessage.rawHeaders.

test("countRawHeaderOccurrences: 0 ocurrencias — array vacío y array con otros headers", () => {
  assert.equal(countRawHeaderOccurrences([], "x-external-id"), 0);
  assert.equal(
    countRawHeaderOccurrences(
      ["Host", "127.0.0.1", "Content-Type", "application/json"],
      "x-external-id",
    ),
    0,
  );
});

test("countRawHeaderOccurrences: 1 ocurrencia entre otros headers", () => {
  const raw = ["Host", "127.0.0.1", "x-external-id", "abc", "Content-Type", "application/json"];
  assert.equal(countRawHeaderOccurrences(raw, "x-external-id"), 1);
});

test("countRawHeaderOccurrences: 2 y 3 ocurrencias se cuentan todas", () => {
  const dos = ["x-api-key", "ka", "Host", "h", "x-api-key", "kb"];
  assert.equal(countRawHeaderOccurrences(dos, "x-api-key"), 2);

  const tres = ["x-api-key", "ka", "x-api-key", "kb", "x-api-key", "kc"];
  assert.equal(countRawHeaderOccurrences(tres, "x-api-key"), 3);
});

test("countRawHeaderOccurrences: case-insensitive en las dos direcciones", () => {
  // rawHeaders conserva la capitalización del wire; el nombre buscado puede
  // venir en cualquier caso también.
  const raw = ["X-External-Id", "a", "x-EXTERNAL-id", "b"];
  assert.equal(countRawHeaderOccurrences(raw, "x-external-id"), 2);
  assert.equal(countRawHeaderOccurrences(raw, "X-External-Id"), 2);
});

test("countRawHeaderOccurrences: no cuenta headers de otro nombre ni valores que parecen nombres", () => {
  // "x-api-key" aparece como VALOR (posición impar) — el recorrido de a pares
  // no puede confundirlo con un nombre.
  const raw = ["X-Descripcion", "x-api-key", "x-api-key", "ka"];
  assert.equal(countRawHeaderOccurrences(raw, "x-api-key"), 1);
  assert.equal(countRawHeaderOccurrences(raw, "x-descripcion"), 1);
  assert.equal(countRawHeaderOccurrences(raw, "x-external-id"), 0);
});
