import assert from "node:assert/strict";
import { test } from "node:test";
import { baseDeLaApiPublica, buildQrImageUrl, contenidoDelQr, qrPng } from "./qrImage";

// ---------------------------------------------------------------------------
// La imagen del QR del encabezado del WhatsApp: qué codifica y desde qué URL
// la baja Meta. Pura, sin base ni red.
// ---------------------------------------------------------------------------

const ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
const QR_BASE = "https://nexoraqrs.com";
const API = "https://plataformacrm.onrender.com";

test("contenidoDelQr: el link público del QR de la sucursal (/r) o del cupón (/v)", () => {
  assert.equal(contenidoDelQr("r", ID, QR_BASE), `${QR_BASE}/r/${ID}`);
  assert.equal(contenidoDelQr("v", ID, QR_BASE), `${QR_BASE}/v/${ID}`);
  assert.equal(contenidoDelQr("r", ID.toUpperCase(), QR_BASE), `${QR_BASE}/r/${ID}`);
});

test("contenidoDelQr: sin QR_PUBLIC_BASE_URL el cupón cae al id pelado y el QR de sucursal no existe", () => {
  assert.equal(contenidoDelQr("v", ID, undefined), ID);
  assert.equal(contenidoDelQr("r", ID, undefined), null);
});

test("contenidoDelQr: un id que no es UUID no codifica nada", () => {
  assert.equal(contenidoDelQr("r", "../../etc", QR_BASE), null);
  assert.equal(contenidoDelQr("v", "", QR_BASE), null);
});

test("buildQrImageUrl: la URL absoluta del PNG en este backend, o null sin base pública", () => {
  assert.equal(buildQrImageUrl("r", ID, API), `${API}/qr-images/r/${ID}.png`);
  assert.equal(buildQrImageUrl("v", ID.toUpperCase(), API), `${API}/qr-images/v/${ID}.png`);
  assert.equal(buildQrImageUrl("r", ID, undefined), null);
  assert.equal(buildQrImageUrl("r", "no-es-uuid", API), null);
});

test("baseDeLaApiPublica: PUBLIC_API_BASE_URL gana; si falta, la de Render", () => {
  assert.equal(
    baseDeLaApiPublica({ PUBLIC_API_BASE_URL: "https://a.test", RENDER_EXTERNAL_URL: API }),
    "https://a.test",
  );
  assert.equal(baseDeLaApiPublica({ RENDER_EXTERNAL_URL: API }), API);
  assert.equal(baseDeLaApiPublica({}), undefined);
});

test("qrPng: un PNG, el mismo para el mismo link y otro para otro link", async () => {
  const png = await qrPng(`${QR_BASE}/v/${ID}`);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  // Cacheable para siempre (Cache-Control immutable): misma URL, mismos bytes.
  assert.ok(png.equals(await qrPng(`${QR_BASE}/v/${ID}`)));
  assert.ok(!png.equals(await qrPng(`${QR_BASE}/r/${ID}`)));
});
