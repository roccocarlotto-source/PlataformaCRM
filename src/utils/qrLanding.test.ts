import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLandingHtml, buildSingleUseConfirmHtml, buildSingleUseUsedHtml } from "./qrLanding";

// Puerto de Plataforma-QR/supabase/functions/_shared/landing.test.ts. Sin base
// y sin HTTP: son funciones puras que devuelven HTML. El copy de single-use es
// provisional (OQ-2 original), así que se afirma estructura y comportamiento,
// no el texto exacto.

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

test("buildLandingHtml omite el link de claim cuando no hay qrId ni claimAppUrl", () => {
  const html = buildLandingHtml();
  assert.equal(html.includes("¿Sos el dueño"), false);
});

test("buildLandingHtml incluye el link de claim apuntando al frontend", () => {
  const html = buildLandingHtml({ qrId: QR_ID, claimAppUrl: "http://localhost:5173" });
  assert.ok(html.includes(`http://localhost:5173/claim/${QR_ID}`));
});

test("buildLandingHtml saca la barra final de claimAppUrl", () => {
  const html = buildLandingHtml({ qrId: QR_ID, claimAppUrl: "http://localhost:5173/" });
  assert.ok(html.includes(`http://localhost:5173/claim/${QR_ID}`));
  assert.equal(html.includes("5173//claim"), false);
});

test("buildLandingHtml nunca renderiza el link de claim sin claimAppUrl (Fase 3 pendiente)", () => {
  const html = buildLandingHtml({ qrId: QR_ID });
  assert.equal(html.includes("¿Sos el dueño"), false);
});

test("buildLandingHtml escapa el href del link de claim", () => {
  // claimAppUrl viene del entorno, no de un usuario, pero el escape es lo que
  // hace que un valor raro no rompa el HTML. encodeURIComponent cubre el qrId.
  const html = buildLandingHtml({ qrId: QR_ID, claimAppUrl: 'http://x.test/"><script>' });
  assert.equal(html.includes('"><script>'), false);
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;"));
});

test('buildSingleUseConfirmHtml renderiza un <form method="POST"> real — nunca un botón solo del lado del cliente', () => {
  const html = buildSingleUseConfirmHtml();
  assert.ok(html.includes('<form method="POST">'));
  assert.ok(html.includes("Continuar"));
});

test("buildSingleUseConfirmHtml no embebe ninguna URL de destino — la página nunca la revela antes del consumo", () => {
  const html = buildSingleUseConfirmHtml();
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("https://"), false);
});

test("buildSingleUseUsedHtml no tiene botón Continuar ni form", () => {
  const html = buildSingleUseUsedHtml();
  assert.equal(html.includes("Continuar"), false);
  assert.equal(html.includes("<form"), false);
});

test("las tres páginas son distintas entre sí ('ya usado' no es la landing genérica — Cycle 27 §7)", () => {
  const confirm = buildSingleUseConfirmHtml();
  const used = buildSingleUseUsedHtml();
  const generic = buildLandingHtml();
  assert.notEqual(confirm, used);
  assert.notEqual(used, generic);
  assert.notEqual(confirm, generic);
});
