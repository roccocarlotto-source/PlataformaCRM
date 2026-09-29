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

test("F5: sin país por defecto, un local con 0 no se normaliza — no se inventa un código de país", () => {
  // Local con el 0 de larga distancia.
  assert.equal(normalizarTelefono("099 123 456"), null);
  assert.equal(normalizarTelefono("099 123 456", null), null);
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

// ---------------------------------------------------------------------------
// F5-b (pendientes post F1–F5): país por defecto de la organización.
// ---------------------------------------------------------------------------

test("F5-b: con país por defecto, el 0 de larga distancia se reemplaza por el código", () => {
  assert.equal(normalizarTelefono("099 123 456", "598"), "+59899123456");
  assert.equal(normalizarTelefono("(099) 123-456", "598"), "+59899123456");
  assert.equal(normalizarTelefono("011 4444-5555", "54"), "+541144445555");
});

test("F5-b: 00 es el prefijo internacional, con o sin país por defecto", () => {
  assert.equal(normalizarTelefono("00598 99 123 456"), "+59899123456");
  assert.equal(normalizarTelefono("00598 99 123 456", "598"), "+59899123456");
  assert.equal(normalizarTelefono("0054 9 11 4444 5555", "598"), "+5491144445555");
});

test("F5-b: lo que ya es internacional no cambia con el país por defecto", () => {
  assert.equal(normalizarTelefono("+54 9 11 4444 5555", "598"), "+5491144445555");
  assert.equal(normalizarTelefono("59899123456", "598"), "+59899123456");
  // Con "+", un 0 detrás es un error y no un prefijo local.
  assert.equal(normalizarTelefono("+099123456", "598"), null);
});

test("F5-b: un código de país inválido se ignora en vez de inventar un número", () => {
  assert.equal(normalizarTelefono("099 123 456", ""), null);
  assert.equal(normalizarTelefono("099 123 456", "0598"), null);
  assert.equal(normalizarTelefono("099 123 456", "+598"), null);
  assert.equal(normalizarTelefono("099 123 456", "5a"), null);
});

test("F5-b: el resultado sigue sujeto al largo de E.164", () => {
  // 3 dígitos de país + 13 del local sin el 0 = 16: no normaliza.
  assert.equal(normalizarTelefono("0" + "9".repeat(13), "598"), null);
  // Un local de un dígito tampoco.
  assert.equal(normalizarTelefono("09", "598"), null);
});
