import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanySchema, updateCompanySchema } from "./company.controller";

// M-10 (docs/auditoria-2026-08-29.md) — PATCH tiene que poder vaciar los
// campos opcionales de Company. domain/industry/phone/city/country eran
// `z.string()...optional()` sin `.nullable()` en un objeto compartido con
// create, así que `PATCH {"domain": null}` rebotaba con 400 de Zod antes de
// llegar al service, aunque UpdateCompanyInput y UpdateCompanyData ya los
// tipaban `string | null`.
//
// Sin base y sin HTTP: lo que está bajo prueba es la frontera del schema. Es
// el mismo criterio que opportunity.controller.test.ts (M-9). La escritura
// real del null contra Postgres está en company.service.integration-test.ts.

const CAMPOS_ANULABLES = ["domain", "industry", "phone", "city", "country"] as const;

test("M-10: PATCH acepta null en domain/industry/phone/city/country y lo conserva como null", () => {
  for (const campo of CAMPOS_ANULABLES) {
    const resultado = updateCompanySchema.safeParse({ [campo]: null });
    assert.equal(resultado.success, true, `${campo}: null se rechazaba con 400`);
    assert.equal(resultado.success && resultado.data[campo], null);
  }
});

test("M-10: PATCH con los cinco campos en null a la vez", () => {
  const resultado = updateCompanySchema.safeParse({
    domain: null,
    industry: null,
    phone: null,
    city: null,
    country: null,
  });
  assert.equal(resultado.success, true);
});

test("M-10: PATCH sigue aceptando strings y sigue exigiendo al menos un campo", () => {
  const conValor = updateCompanySchema.safeParse({ domain: " acme.com " });
  assert.equal(conValor.success, true);
  assert.equal(conValor.success && conValor.data.domain, "acme.com", "el trim se conserva");

  assert.equal(updateCompanySchema.safeParse({}).success, false);
});

// Comportamiento existente, sin cambios: no se puede CREAR una empresa con
// estos campos explícitamente en null (se omiten). Queda fijado con test para
// que el objeto compartido no vuelva a mezclar las dos nulabilidades sin que
// nadie lo note.
test("M-10: create sigue rechazando null en domain/industry/phone/city/country", () => {
  for (const campo of CAMPOS_ANULABLES) {
    const resultado = createCompanySchema.safeParse({ name: "Acme", [campo]: null });
    assert.equal(resultado.success, false, `create con ${campo}: null tiene que seguir siendo 400`);
  }
});

test("M-10: create sin esos campos, o con strings, sigue funcionando", () => {
  assert.equal(createCompanySchema.safeParse({ name: "Acme" }).success, true);
  assert.equal(
    createCompanySchema.safeParse({ name: "Acme", domain: "acme.com", city: "Rosario" }).success,
    true,
  );
});

// ownerId queda fuera de M-10 a propósito: no es anulable en ninguno de los
// dos schemas (toda empresa tiene dueño).
test("M-10: ownerId NO admite null ni en create ni en update", () => {
  assert.equal(createCompanySchema.safeParse({ name: "Acme", ownerId: null }).success, false);
  assert.equal(updateCompanySchema.safeParse({ ownerId: null }).success, false);
});
