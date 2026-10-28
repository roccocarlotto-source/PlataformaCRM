import assert from "node:assert/strict";
import { test } from "node:test";
import {
  criteriosDeMencion,
  hayCriterios,
  patronDeEmail,
  patronDeNombre,
  patronDeTelefono,
} from "./mencionDeLaPersona";

// ---------------------------------------------------------------------------
// La parte pura de "¿este texto menciona a la persona?" (borrado a pedido,
// DAT-03/DAT-04). Los patrones son expresiones regulares de Postgres (~* y ~)
// escritas con la sintaxis común a JavaScript, así que se prueban acá con
// RegExp ("i" donde Postgres usa ~*). La aplicación contra la base está en
// borradoCompleto.integration-test.ts.
// ---------------------------------------------------------------------------

function coincide(patron: string | null, texto: string, flags = ""): boolean {
  assert.ok(patron);
  return new RegExp(patron, flags).test(texto);
}

test("el teléfono se encuentra escrito de las formas habituales", () => {
  const patron = patronDeTelefono("+59899000111");
  for (const texto of [
    "llamalo al +59899000111",
    "su cel es 099 000 111",
    "099-000-111.",
    "(099) 000 111",
    "59899000111",
    "+598 99 000 111",
    "00598 99000111",
    "99000111",
    '{"telefono":"099000111"}',
  ]) {
    assert.ok(coincide(patron, texto), texto);
  }
});

test("un número distinto, uno que sigue con más dígitos, o uno de otro país, no", () => {
  const patron = patronDeTelefono("+59899000111");
  for (const texto of [
    "099 000 112",
    "0990001119",
    "99000",
    "el pedido 123",
    // Testigo de la revisión de #585: otro país, mismos últimos 8 dígitos.
    "+54 99 000 111",
    "+5499000111",
    "5499000111",
    "1299000111",
  ]) {
    assert.ok(!coincide(patron, texto), texto);
  }
});

test("sin teléfono, o con menos de 8 dígitos, no hay patrón", () => {
  assert.equal(patronDeTelefono(null), null);
  assert.equal(patronDeTelefono("12345"), null);
  assert.equal(patronDeTelefono("2901 234"), null, "7 dígitos");
  assert.ok(patronDeTelefono("2901 2345"), "8 dígitos");
});

test("nombre completo como palabra entera, sin distinguir mayúsculas", () => {
  const patron = patronDeNombre("Ana López");
  for (const texto of [
    "Hablé con Ana López",
    "ANA LÓPEZ.",
    "ana  lópez, la de ayer",
    "(Ana López)",
  ]) {
    assert.ok(coincide(patron, texto, "i"), texto);
  }
  // Testigo de la revisión de #585: el nombre completo de OTRA persona que
  // contiene al de esta.
  for (const texto of ["Hablé con Mariana López", "Ana Lópezz", "Ana López2", "ana_lópez"]) {
    assert.ok(!coincide(patron, texto, "i"), texto);
  }
});

test("email sin nada pegado a la izquierda ni un dominio más largo a la derecha", () => {
  const patron = patronDeEmail("ana@example.test");
  for (const texto of [
    "escribile a ana@example.test",
    "ANA@EXAMPLE.TEST.",
    "<ana@example.test>",
    '{"email":"ana@example.test"}',
  ]) {
    assert.ok(coincide(patron, texto, "i"), texto);
  }
  // Testigo de la revisión de #585: otro email que termina igual.
  for (const texto of [
    "juliana@example.test",
    "j.ana@example.test",
    "x+ana@example.test",
    "ana@example.test.uy",
    "ana@example.testing",
  ]) {
    assert.ok(!coincide(patron, texto, "i"), texto);
  }
});

test("los caracteres especiales del nombre o el email son literales", () => {
  const patron = patronDeEmail("a.b+c@example.test");
  assert.ok(coincide(patron, "a.b+c@example.test", "i"));
  assert.ok(!coincide(patron, "aXb+c@example.test", "i"), "el punto no es comodín");
});

test("nombre COMPLETO; nunca el de pila solo", () => {
  const c = criteriosDeMencion({
    firstName: " Juan ",
    lastName: "Pérez",
    email: " Juan@Example.TEST ",
    phone: null,
  });
  assert.ok(coincide(c.nombreCompleto, "vino juan pérez", "i"));
  assert.ok(coincide(c.email, "juan@example.test", "i"));
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
