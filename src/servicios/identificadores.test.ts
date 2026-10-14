import assert from "node:assert/strict";
import { test } from "node:test";
import { formatearNumeroDeOrden, normalizarIdentificador } from "./identificadores";

test("normalizarIdentificador: mayúsculas, solo letras y dígitos", () => {
  assert.equal(normalizarIdentificador("abc 1234"), "ABC1234");
  assert.equal(normalizarIdentificador("ABC-1234"), "ABC1234");
  assert.equal(normalizarIdentificador(" sbc.12-34 "), "SBC1234");
  assert.equal(normalizarIdentificador("9bwzzz377vt004251"), "9BWZZZ377VT004251");
});

test("normalizarIdentificador: lo que no tiene letras ni dígitos queda vacío", () => {
  assert.equal(normalizarIdentificador(" - . "), "");
  // Una letra con tilde no es [A-Z]: el CHECK de la base tampoco la acepta.
  assert.equal(normalizarIdentificador("Ñ1"), "1");
});

test("formatearNumeroDeOrden: OS- y cuatro dígitos como mínimo", () => {
  assert.equal(formatearNumeroDeOrden(42), "OS-0042");
  assert.equal(formatearNumeroDeOrden(12345), "OS-12345");
});
