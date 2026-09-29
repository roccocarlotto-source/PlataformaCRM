import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizarTelefono, soloDigitos } from "./telefono";

test("soloDigitos saca el + y cualquier separador", () => {
  assert.equal(soloDigitos("+598 99-123.456"), "59899123456");
  assert.equal(soloDigitos("59899123456"), "59899123456");
});

test("F5: con o sin + es el mismo número, y queda como + seguido solo de dígitos", () => {
  assert.equal(normalizarTelefono("59894000111"), "+59894000111");
  assert.equal(normalizarTelefono("+59894000111"), "+59894000111");
  assert.equal(normalizarTelefono("  +598 94 000 111  "), "+59894000111");
  assert.equal(normalizarTelefono("+54 9 11 5555-0000"), "+5491155550000");
  assert.equal(normalizarTelefono("+1 (415) 555.0100"), "+14155550100");
});

test("F5: un número que empieza con 0 no se normaliza — no se inventa un código de país", () => {
  // Local con el 0 de larga distancia.
  assert.equal(normalizarTelefono("099 123 456"), null);
  // Prefijo de salida internacional: depende del país desde el que se marca.
  assert.equal(normalizarTelefono("00598 99 123 456"), null);
  // Un "+" delante no lo arregla: ningún código de país empieza con 0.
  assert.equal(normalizarTelefono("+099123456"), null);
});

test("F5: lo que no es un teléfono no se normaliza", () => {
  assert.equal(normalizarTelefono(""), null);
  assert.equal(normalizarTelefono("   "), null);
  assert.equal(normalizarTelefono("sí"), null);
  assert.equal(normalizarTelefono("+598 99 123 456 int 3"), null);
  assert.equal(normalizarTelefono("++59899123456"), null);
  assert.equal(normalizarTelefono("598+99123456"), null);
});

test("F5: entre 7 y 15 dígitos (E.164)", () => {
  assert.equal(normalizarTelefono("123456"), null);
  assert.equal(normalizarTelefono("1234567"), "+1234567");
  assert.equal(normalizarTelefono("123456789012345"), "+123456789012345");
  assert.equal(normalizarTelefono("1234567890123456"), null);
});
