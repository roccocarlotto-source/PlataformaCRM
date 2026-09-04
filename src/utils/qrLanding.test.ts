import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLandingHtml } from "./qrLanding";

// Puerto de Plataforma-QR/supabase/functions/_shared/landing.test.ts. Sin base
// y sin HTTP: es una función pura que devuelve HTML.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// probaba el link de claim (qrId/claimAppUrl) y las páginas del QR de un solo
// uso (buildSingleUseConfirmHtml/buildSingleUseUsedHtml) — se eliminaron
// junto con esas funcionalidades.

test("buildLandingHtml no ofrece ningún link de claim — el módulo QR ya no tiene QR físico", () => {
  const html = buildLandingHtml();
  assert.equal(html.includes("¿Sos el dueño"), false);
});

test("buildLandingHtml muestra el mensaje genérico de 'no está activo'", () => {
  const html = buildLandingHtml();
  assert.ok(html.includes("Este código todavía no está activo"));
});

test("buildLandingHtml es determinística — misma llamada, mismo HTML byte a byte (DEC-007)", () => {
  assert.equal(buildLandingHtml(), buildLandingHtml());
});
