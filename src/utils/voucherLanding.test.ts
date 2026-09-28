import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLandingHtml } from "./qrLanding";
import { buildVoucherLandingHtml, voucherQrDataUrl } from "./voucherLanding";

// Página pública del cupón (ítem 178). Sin base y sin HTTP: función pura
// (async solo por la generación del QR).

const LINK = "https://nexoraqrs.com/v/5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
const LABEL = "15% de descuento en el taller";

test("ACTIVE: label, 'Activo' y la imagen del QR como data URL PNG", async () => {
  const html = await buildVoucherLandingHtml({ status: "ACTIVE", label: LABEL }, LINK);
  assert.ok(html.includes(`<h1>${LABEL}</h1>`));
  assert.ok(html.includes(">Activo<"));
  assert.match(html, /<img class="qr" src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  assert.ok(html.includes(`src="${await voucherQrDataUrl(LINK)}"`), "codifica el link recibido");
});

test("CONSUMED: 'Ya canjeado', sin QR", async () => {
  const html = await buildVoucherLandingHtml({ status: "CONSUMED", label: LABEL }, LINK);
  assert.ok(html.includes(`<h1>${LABEL}</h1>`));
  assert.ok(html.includes(">Ya canjeado<"));
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("data:image"), false);
});

test("EXPIRED: 'Vencido', sin QR", async () => {
  const html = await buildVoucherLandingHtml({ status: "EXPIRED", label: LABEL }, LINK);
  assert.ok(html.includes(">Vencido<"));
  assert.equal(html.includes("<img"), false);
});

test("estado nulo -> la MISMA landing genérica que el QR normal (DEC-007)", async () => {
  assert.equal(await buildVoucherLandingHtml(null, LINK), buildLandingHtml());
});

test("el label se escapa: texto libre de un ADMIN no inyecta HTML", async () => {
  const html = await buildVoucherLandingHtml(
    { status: "CONSUMED", label: `<script>alert("x")</script> & 'y'` },
    LINK,
  );
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;"));
});
