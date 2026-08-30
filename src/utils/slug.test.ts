import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./slug";

test("baja a minúsculas y separa palabras con guion", () => {
  assert.equal(slugify("Acme Corp"), "acme-corp");
});

test("elimina los acentos descomponiendo en NFD", () => {
  assert.equal(slugify("Acmé Corporación"), "acme-corporacion");
  assert.equal(slugify("Ñandú"), "nandu");
  assert.equal(slugify("Über Straße"), "uber-stra-e");
});

test("colapsa cualquier corrida de caracteres no alfanuméricos en un guion", () => {
  assert.equal(slugify("Foo   &&&   Bar"), "foo-bar");
  assert.equal(slugify("A.B.C"), "a-b-c");
});

test("recorta guiones sobrantes en los extremos", () => {
  assert.equal(slugify("  ¡Hola!  "), "hola");
  assert.equal(slugify("---Acme---"), "acme");
});

test("trunca a 100 caracteres", () => {
  const slug = slugify("a".repeat(150));
  assert.equal(slug.length, 100);
});

// Decisión de diseño registrada en utils/slug.ts: slugify NO agrega sufijo
// para desambiguar. Dos nombres distintos pueden producir el mismo slug, y
// eso se resuelve como 409 aguas arriba (onboarding.service.ts:35-38 y la
// constraint única de la base), no acá. Estos tests fijan esa decisión: si
// alguien agrega un sufijo -2, fallan.
test("colisión: dos nombres distintos producen el mismo slug", () => {
  assert.equal(slugify("Acme Corp"), slugify("ACME   corp!"));
  assert.equal(slugify("Acmé Corp"), slugify("Acme Corp"));
});

test("colisión por truncado: dos nombres que difieren después del caracter 100", () => {
  const base = "a".repeat(100);
  assert.equal(slugify(base + "-uno"), slugify(base + "-dos"));
});

// Un nombre compuesto solo por caracteres no alfanuméricos produce el slug
// vacío, y ESTO NO CAMBIA: slugify es una función genérica y rechazar ese
// resultado es responsabilidad de quien lo usa para algo que tiene que ser no
// vacío — mismo criterio que ya rige acá para las colisiones ("se resuelve
// como error aguas arriba, no acá"). Fue el M-27 de la auditoría del 21/08
// (reabierto como M-13 en la del 29/08) y se corrigió aguas arriba: el schema
// de onboarding valida min(1) sobre el NOMBRE, no sobre el slug, así que
// onboardOrganization rechaza con 400 cuando slugify devuelve "" — ver
// onboarding.service.ts y su test de integración.
test("un nombre sin caracteres alfanuméricos produce el slug vacío", () => {
  assert.equal(slugify("###"), "");
  assert.equal(slugify("株式会社"), "");
});
