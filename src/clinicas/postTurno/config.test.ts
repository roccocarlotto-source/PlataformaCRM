import assert from "node:assert/strict";
import { test } from "node:test";
import { configDelControlSchema, configDelQrDeResenaSchema } from "./acciones";
import {
  TEXTO_POR_DEFECTO_DEL_CONTROL,
  TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  cuandoSaleElControl,
  cuandoSaleElQr,
  semanasDelControl,
} from "./config";

// ---------------------------------------------------------------------------
// R14 (docs/rubros.md §7), sin base: cuándo salen el QR y el control, el
// {semanas} y los textos por defecto contra sus schemas.
// ---------------------------------------------------------------------------

const H = 60 * 60 * 1000;
const CIERRE = new Date("2027-03-01T15:00:00Z");

test("cuandoSaleElQr: la demora de la regla (mínimo 3 h); tras un cierre automático, 24 h", () => {
  assert.equal(cuandoSaleElQr(CIERRE, 240, false).getTime(), CIERRE.getTime() + 4 * H);
  assert.equal(cuandoSaleElQr(CIERRE, 60, false).getTime(), CIERRE.getTime() + 3 * H);
  assert.equal(cuandoSaleElQr(CIERRE, 240, true).getTime(), CIERRE.getTime() + 24 * H);
});

test("cuandoSaleElControl y {semanas}", () => {
  assert.equal(cuandoSaleElControl(CIERRE, 28).getTime(), CIERRE.getTime() + 28 * 24 * H);
  assert.equal(semanasDelControl(28), "4");
  assert.equal(semanasDelControl(10), "1");
  assert.equal(semanasDelControl(3), "1");
  assert.equal(semanasDelControl(730), "104");
});

test("los textos por defecto pasan sus schemas y no llevan la prestación", () => {
  const qr = configDelQrDeResenaSchema.safeParse({
    qrCodeId: "11111111-1111-4111-8111-111111111111",
    delayMinutes: 180,
    whatsappFormat: "LINK",
    messageText: TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  });
  assert.equal(qr.success, true, qr.success ? "" : qr.error.message);
  assert.equal(
    configDelControlSchema.safeParse({ messageText: TEXTO_POR_DEFECTO_DEL_CONTROL }).success,
    true,
  );
  for (const texto of [TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA, TEXTO_POR_DEFECTO_DEL_CONTROL]) {
    assert.doesNotMatch(texto, /prestaci/i);
  }
});

test("el QR de una clínica no acepta menos de 3 h de demora", () => {
  const r = configDelQrDeResenaSchema.safeParse({
    qrCodeId: "11111111-1111-4111-8111-111111111111",
    delayMinutes: 120,
    messageText: TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  });
  assert.equal(r.success, false);
});

test("el control no acepta variables ajenas", () => {
  assert.equal(
    configDelControlSchema.safeParse({
      messageText: "Hola {nombre}, ¿cómo va tu {prestacion}? Escribinos.",
    }).success,
    false,
  );
});
