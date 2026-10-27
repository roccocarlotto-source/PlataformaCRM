import assert from "node:assert/strict";
import { test } from "node:test";
import { criteriosDeMencion, hayCriterios, patronDeTelefono } from "./mencionDeLaPersona";

// ---------------------------------------------------------------------------
// La parte pura de "¿este texto menciona a la persona?" (borrado a pedido,
// DAT-03/DAT-04). El patrón del teléfono es una expresión regular de Postgres
// (~); la sintaxis que usa ([ ().-]{0,2} y ([^0-9]|$)) es la misma en
// JavaScript, así que se prueba acá con RegExp. La aplicación contra la base
// está en borradoCompleto.integration-test.ts.
// ---------------------------------------------------------------------------

function coincide(phone: string, texto: string): boolean {
  const patron = patronDeTelefono(phone);
  assert.ok(patron);
  return new RegExp(patron).test(texto);
}

test("el teléfono se encuentra escrito de las formas habituales", () => {
  for (const texto of [
    "llamalo al +59899000111",
    "su cel es 099 000 111",
    "099-000-111.",
    "(099) 000 111",
    "59899000111",
    '{"telefono":"099000111"}',
  ]) {
    assert.ok(coincide("+59899000111", texto), texto);
  }
});

test("un número distinto, o uno que sigue con más dígitos, no", () => {
  for (const texto of ["099 000 112", "0990001119", "99000", "el pedido 123"]) {
    assert.ok(!coincide("+59899000111", texto), texto);
  }
});

test("sin teléfono, o con menos de 7 dígitos, no hay patrón", () => {
  assert.equal(patronDeTelefono(null), null);
  assert.equal(patronDeTelefono("12345"), null);
  assert.equal(patronDeTelefono("+1 23"), null);
});

test("nombre COMPLETO en minúsculas; nunca el de pila solo", () => {
  const c = criteriosDeMencion({
    firstName: " Juan ",
    lastName: "Pérez",
    email: " Juan@Example.TEST ",
    phone: null,
  });
  assert.equal(c.nombreCompleto, "juan pérez");
  assert.equal(c.email, "juan@example.test");
  assert.equal(c.telefono, null);

  const soloNombre = criteriosDeMencion({
    firstName: "Juan",
    lastName: " ",
    email: null,
    phone: null,
  });
  assert.equal(soloNombre.nombreCompleto, null);
  assert.equal(hayCriterios(soloNombre), false, "sin apellido, email ni teléfono no se busca nada");
});
