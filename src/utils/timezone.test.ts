import assert from "node:assert/strict";
import { test } from "node:test";
import { esZonaHorariaValida } from "./timezone";

// Unitario, sin base ni red. Es la validación que impide que una sucursal nazca
// con una zona horaria que no existe — un dato que no falla al guardarse y
// falla mucho después, con un turno a la hora equivocada como único síntoma.

test("acepta zonas IANA reales, incluida la que usa este proyecto", () => {
  assert.equal(esZonaHorariaValida("America/Argentina/Buenos_Aires"), true);
  assert.equal(esZonaHorariaValida("America/Montevideo"), true);
  assert.equal(esZonaHorariaValida("Europe/Madrid"), true);
});

test("acepta UTC, que es el default de la columna", () => {
  assert.equal(esZonaHorariaValida("UTC"), true);
});

test("rechaza los errores de tipeo que de verdad se cometen", () => {
  // Con espacio en vez de guion bajo.
  assert.equal(esZonaHorariaValida("America/Buenos Aires"), false);
  // Continente mal escrito.
  assert.equal(esZonaHorariaValida("Amrica/Argentina/Buenos_Aires"), false);
  // Inventada.
  assert.equal(esZonaHorariaValida("Mars/Olympus_Mons"), false);
});

test("rechaza una cadena vacía y una de espacios", () => {
  assert.equal(esZonaHorariaValida(""), false);
  assert.equal(esZonaHorariaValida("   "), false);
});

test("rechaza un offset crudo — un desplazamiento no sabe de horario de verano", () => {
  // ESTE TEST ENCONTRÓ UN AGUJERO REAL en la primera versión del validador.
  //
  // La suposición era que `Intl` rechazaba los offsets. Rechaza "GMT-3" (por
  // formato), pero ACEPTA "-03:00" y "+03:00": ECMA-402 los admite como zona.
  // Y son justo lo que no sirve — un desplazamiento produce horarios correctos
  // medio año y equivocados el otro medio, sin ningún síntoma hasta que un
  // cliente no aparece. Es lo que §4 del documento de diseño quiere evitar.
  assert.equal(esZonaHorariaValida("GMT-3"), false);
  assert.equal(esZonaHorariaValida("-03:00"), false);
  assert.equal(esZonaHorariaValida("+03:00"), false);
});

test("acepta Etc/GMT+3: es una zona IANA real, no un offset escrito a mano", () => {
  // La distinción con el caso de arriba: `Etc/GMT+3` resuelve a `Etc/GMT+3`, no
  // a un desplazamiento. Es una elección rara pero deliberada; "-03:00" es un
  // dedo resbalado. El filtro mira la forma RESUELTA, no la escrita, y por eso
  // los distingue.
  assert.equal(esZonaHorariaValida("Etc/GMT+3"), true);
});

test("no lanza nunca: devuelve false en vez de propagar el RangeError", () => {
  // La función existe para poder usarse dentro de un .refine() de Zod, donde una
  // excepción se leería como un error 500 en vez de como un 400 de validación.
  assert.doesNotThrow(() => esZonaHorariaValida("cualquier cosa"));
  assert.equal(esZonaHorariaValida("cualquier cosa"), false);
});
