import assert from "node:assert/strict";
import { test } from "node:test";
import { esZonaHorariaValida, isoEnZona } from "./timezone";

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

// ---------------------------------------------------------------------------
// isoEnZona (ítem 104)
// ---------------------------------------------------------------------------

test("isoEnZona escribe el MISMO instante en la zona pedida, con offset", () => {
  // El caso real: el agente leía este instante como "las 14" y le decía a un
  // cliente de Montevideo que a las 11 no había lugar.
  const instante = new Date("2026-09-30T14:00:00.000Z");
  assert.equal(isoEnZona(instante, "America/Montevideo"), "2026-09-30T11:00:00-03:00");
  assert.equal(isoEnZona(instante, "UTC"), "2026-09-30T14:00:00+00:00");
  assert.equal(isoEnZona(instante, "Europe/Madrid"), "2026-09-30T16:00:00+02:00");
  assert.equal(isoEnZona(instante, "Asia/Kolkata"), "2026-09-30T19:30:00+05:30");
});

test("isoEnZona devuelve un instante equivalente al original", () => {
  // La garantía que importa: cambia la forma, no el momento.
  for (const zona of ["America/Montevideo", "UTC", "Europe/Madrid", "Asia/Kolkata"]) {
    for (const iso of [
      "2026-09-30T14:00:00.000Z",
      "2026-01-15T03:30:00.000Z",
      "2026-12-31T23:59:00.000Z",
    ]) {
      const original = new Date(iso);
      assert.equal(
        new Date(isoEnZona(original, zona)).getTime(),
        original.getTime(),
        `${iso} en ${zona}`,
      );
    }
  }
});

test("isoEnZona respeta el horario de verano", () => {
  // Montevideo no tiene DST hoy; Madrid sí: el mismo reloj cambia de offset
  // entre enero y julio.
  const invierno = isoEnZona(new Date("2026-01-15T12:00:00.000Z"), "Europe/Madrid");
  const verano = isoEnZona(new Date("2026-07-15T12:00:00.000Z"), "Europe/Madrid");
  assert.ok(invierno.endsWith("+01:00"), invierno);
  assert.ok(verano.endsWith("+02:00"), verano);
});

test("isoEnZona escribe la medianoche como 00, no como 24", () => {
  assert.match(isoEnZona(new Date("2026-09-30T03:00:00.000Z"), "America/Montevideo"), /T00:00:00/);
});
