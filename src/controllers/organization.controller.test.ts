import assert from "node:assert/strict";
import { test } from "node:test";
import { updateOrganizationCurrencySchema } from "./organization.controller";

// ---------------------------------------------------------------------------
// La frontera del PATCH /api/organization (Fase 2c), sin base y sin HTTP: qué
// acepta y qué rechaza el schema. Que el 400 por "preferida === alternativa"
// y el 403 para USER sean propiedades del sistema montado se prueba en
// organization.controller.integration-test.ts.
// ---------------------------------------------------------------------------

test("acepta códigos ISO 4217 y los normaliza a mayúsculas sin espacios", () => {
  const parsed = updateOrganizationCurrencySchema.safeParse({
    preferredCurrency: " usd ",
    alternateCurrency: "ars",
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, {
    preferredCurrency: "USD",
    alternateCurrency: "ARS",
  });
});

test("null des-configura una moneda; undefined no la toca", () => {
  const parsed = updateOrganizationCurrencySchema.safeParse({ alternateCurrency: null });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, { alternateCurrency: null });
});

test("rechaza lo que no es un código de 3 letras", () => {
  for (const valor of ["US", "USDT", "U$D", "123", "", 42]) {
    const parsed = updateOrganizationCurrencySchema.safeParse({ preferredCurrency: valor });
    assert.equal(parsed.success, false, `${JSON.stringify(valor)} no es ISO 4217`);
  }
});

test("exige al menos un campo en el body", () => {
  assert.equal(updateOrganizationCurrencySchema.safeParse({}).success, false);
});
