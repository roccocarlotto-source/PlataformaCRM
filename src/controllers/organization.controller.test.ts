import assert from "node:assert/strict";
import { test } from "node:test";
import { updateOrganizationSettingsSchema } from "./organization.controller";

// ---------------------------------------------------------------------------
// La frontera del PATCH /api/organization (Fase 2c), sin base y sin HTTP: qué
// acepta y qué rechaza el schema. Que el 400 por "preferida === alternativa"
// y el 403 para USER sean propiedades del sistema montado se prueba en
// organization.controller.integration-test.ts.
// ---------------------------------------------------------------------------

test("acepta códigos ISO 4217 y los normaliza a mayúsculas sin espacios", () => {
  const parsed = updateOrganizationSettingsSchema.safeParse({
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
  const parsed = updateOrganizationSettingsSchema.safeParse({ alternateCurrency: null });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, { alternateCurrency: null });
});

test("rechaza lo que no es un código de 3 letras", () => {
  for (const valor of ["US", "USDT", "U$D", "123", "", 42]) {
    const parsed = updateOrganizationSettingsSchema.safeParse({ preferredCurrency: valor });
    assert.equal(parsed.success, false, `${JSON.stringify(valor)} no es ISO 4217`);
  }
});

test("exige al menos un campo en el body", () => {
  assert.equal(updateOrganizationSettingsSchema.safeParse({}).success, false);
});

// F5-b (pendientes post F1–F5): el país por defecto de los teléfonos.
test("F5-b: defaultPhoneCountryCode acepta de 1 a 3 dígitos sin 0 inicial, y null", () => {
  for (const valor of ["1", "54", "598", null]) {
    const parsed = updateOrganizationSettingsSchema.safeParse({ defaultPhoneCountryCode: valor });
    assert.equal(parsed.success, true, `${JSON.stringify(valor)} tiene que aceptarse`);
  }
});

test("F5-b: defaultPhoneCountryCode rechaza lo que no es un código de país", () => {
  for (const valor of ["", "0", "059", "+598", "5981", "5 9", "abc", 598]) {
    const parsed = updateOrganizationSettingsSchema.safeParse({ defaultPhoneCountryCode: valor });
    assert.equal(parsed.success, false, `${JSON.stringify(valor)} no es un código de país`);
  }
});
