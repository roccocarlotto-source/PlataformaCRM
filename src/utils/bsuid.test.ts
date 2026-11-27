import assert from "node:assert/strict";
import { test } from "node:test";
import { enmascararBsuid, enmascararIdDeWhatsapp, enmascararTelefono, esBsuid } from "./bsuid";

// ---------------------------------------------------------------------------
// El BSUID (business-scoped user ID) de WhatsApp: código de país ISO de dos
// letras, un punto y hasta 128 alfanuméricos; el "padre" lleva "ENT." en el
// medio. Un teléfono (wa_id) son solo dígitos, así que nunca se confunden.
// Valores ficticios.
// ---------------------------------------------------------------------------

test("esBsuid: reconoce el BSUID y el BSUID padre", () => {
  assert.equal(esBsuid("UY.1234567890123456789"), true);
  assert.equal(esBsuid("US.ENT.11815799212886844830"), true);
  assert.equal(esBsuid(`BR.${"a".repeat(128)}`), true);
});

test("esBsuid: un teléfono, un vacío o algo mal formado no son BSUID", () => {
  assert.equal(esBsuid("59899000000"), false);
  assert.equal(esBsuid("+59899000000"), false);
  assert.equal(esBsuid(""), false);
  assert.equal(esBsuid("UY1234"), false);
  assert.equal(esBsuid("uy.1234"), false);
  assert.equal(esBsuid("UY."), false);
  assert.equal(esBsuid(`UY.${"a".repeat(129)}`), false);
  assert.equal(esBsuid("UY.12-34"), false);
});

test("enmascararBsuid: deja el país y los últimos 4", () => {
  assert.equal(enmascararBsuid("UY.1234567890123456789"), "UY.…6789");
  assert.equal(enmascararBsuid("US.ENT.11815799212886844830"), "US.ENT.…4830");
});

test("enmascararTelefono: deja los últimos 3 dígitos", () => {
  assert.equal(enmascararTelefono("59899000123"), "…123");
  assert.equal(enmascararTelefono("+598 99 000 123"), "…123");
  assert.equal(enmascararTelefono("12"), "…");
});

test("enmascararIdDeWhatsapp: elige según la forma", () => {
  assert.equal(enmascararIdDeWhatsapp("UY.1234567890123456789"), "UY.…6789");
  assert.equal(enmascararIdDeWhatsapp("59899000123"), "…123");
  assert.equal(enmascararIdDeWhatsapp(undefined), null);
});
