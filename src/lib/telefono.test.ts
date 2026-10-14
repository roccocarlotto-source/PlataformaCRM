import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codigoDePaisEfectivo,
  normalizarTelefono,
  soloDigitos,
  variantesDeBusquedaDeTelefono,
} from "./telefono";

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

test("2026-10-14: sin país por defecto se usa Uruguay (antes, un local con 0 se rechazaba)", () => {
  assert.equal(normalizarTelefono("099 123 456"), "+59899123456");
  assert.equal(normalizarTelefono("099 123 456", null), "+59899123456");
  // Un "+" delante no lo arregla: ningún código de país empieza con 0.
  assert.equal(normalizarTelefono("+099123456"), null);
});

test("2026-10-14: en Uruguay, un número de 8 dígitos sin + es local (fijo o celular sin el 0)", () => {
  assert.equal(normalizarTelefono("099777777", "598"), "+59899777777");
  assert.equal(normalizarTelefono("24001234", "598"), "+59824001234");
  assert.equal(normalizarTelefono("2400 1234", "598"), "+59824001234");
  assert.equal(normalizarTelefono("99777777", "598"), "+59899777777");
  assert.equal(normalizarTelefono("24001234"), "+59824001234", "sin país: Uruguay");
  // Con + se respeta tal cual, aunque tenga 8 dígitos.
  assert.equal(normalizarTelefono("+24001234", "598"), "+24001234");
  // Otro largo sin + sigue siendo internacional.
  assert.equal(normalizarTelefono("59899777777", "598"), "+59899777777");
  assert.equal(normalizarTelefono("5491144445555", "598"), "+5491144445555");
});

test("2026-10-14: la regla del largo nacional es solo de los países que la tienen", () => {
  // Argentina no está en LARGO_NACIONAL: 8 dígitos sin + quedan como estaban.
  assert.equal(normalizarTelefono("44445555", "54"), "+44445555");
  // El 0 de larga distancia sí se completa con cualquier país.
  assert.equal(normalizarTelefono("011 4444-5555", "54"), "+541144445555");
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

test("un código de país inválido se ignora y se usa Uruguay", () => {
  for (const invalido of ["", "0598", "+598", "5a"]) {
    assert.equal(codigoDePaisEfectivo(invalido), "598");
    assert.equal(normalizarTelefono("099 123 456", invalido), "+59899123456");
  }
  assert.equal(codigoDePaisEfectivo("54"), "54");
});

test("búsqueda: lo que escribe una persona encuentra el teléfono guardado", () => {
  // Guardado como +59899777777.
  assert.ok(variantesDeBusquedaDeTelefono("099 777 777", "598").includes("59899777777"));
  assert.ok(variantesDeBusquedaDeTelefono("+598 99 777 777", null).includes("59899777777"));
  // Un pedazo: con o sin el 0 inicial.
  assert.deepEqual(variantesDeBusquedaDeTelefono("0997", "598"), ["0997", "997"]);
  assert.deepEqual(variantesDeBusquedaDeTelefono("777 777", "598"), ["777777"]);
  // Lo que no parece un teléfono no busca por teléfono.
  assert.deepEqual(variantesDeBusquedaDeTelefono("Juan", "598"), []);
  assert.deepEqual(variantesDeBusquedaDeTelefono("099", "598"), []);
  assert.deepEqual(variantesDeBusquedaDeTelefono("juan@acme.com", "598"), []);
  // Solo ceros: nada (un contains vacío encontraría a todos).
  assert.deepEqual(variantesDeBusquedaDeTelefono("0000", "598"), []);
});

test("F5-b: el resultado sigue sujeto al largo de E.164", () => {
  // 3 dígitos de país + 13 del local sin el 0 = 16: no normaliza.
  assert.equal(normalizarTelefono("0" + "9".repeat(13), "598"), null);
  // Un local de un dígito tampoco.
  assert.equal(normalizarTelefono("09", "598"), null);
});
