import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPreapprovalUrl,
  extractNotificationId,
  mapPreapprovalStatus,
} from "./qrWebhook.service";

// Puerto de mercadopago-webhook/index.test.ts (AUD-05) y de la mitad de
// _shared/mercadopago.test.ts que no es firma (mapeo de estados, TF-005).
// Puras, sin base: la orquestación completa contra Postgres vive en
// controllers/qrWebhook.controller.integration-test.ts.

// ---------------------------------------------------------------------------
// AUD-05: dataId viene del query string (influenciable por un atacante). Estos
// tests prueban que encodeURIComponent hace imposible que su valor cambie el
// host, la estructura del path, el query o el fragmento de la URL saliente.
// ---------------------------------------------------------------------------

test("buildPreapprovalUrl: un id numérico pasa sin cambios", () => {
  assert.equal(
    buildPreapprovalUrl("999999999"),
    "https://api.mercadopago.com/preapproval/999999999",
  );
});

test("buildPreapprovalUrl: una barra en el id se codifica, no es un separador de path", () => {
  const url = buildPreapprovalUrl("123/456");
  assert.equal(url, "https://api.mercadopago.com/preapproval/123%2F456");
  assert.equal(new URL(url).pathname, "/preapproval/123%2F456");
});

test("buildPreapprovalUrl: un id con path traversal no escapa de /preapproval/", () => {
  const url = buildPreapprovalUrl("../../v1/payments/123");
  assert.equal(url.includes("/../"), false);
  const parsed = new URL(url);
  assert.equal(parsed.host, "api.mercadopago.com");
  assert.ok(parsed.pathname.startsWith("/preapproval/"));
  assert.equal(parsed.pathname, "/preapproval/..%2F..%2Fv1%2Fpayments%2F123");
});

test("buildPreapprovalUrl: '?', '#' y espacios no alteran query/fragmento/host", () => {
  const conQuery = new URL(buildPreapprovalUrl("123?evil=1"));
  assert.equal(conQuery.search, "");
  assert.equal(conQuery.host, "api.mercadopago.com");

  const conFragmento = new URL(buildPreapprovalUrl("123#evil"));
  assert.equal(conFragmento.hash, "");

  const conEspacio = new URL(buildPreapprovalUrl("123 456"));
  assert.equal(conEspacio.pathname, "/preapproval/123%20456");
});

test("buildPreapprovalUrl: siempre apunta exactamente a api.mercadopago.com/preapproval/<id>, y el id se recupera intacto", () => {
  for (const id of [
    "999999999",
    "2c938084726fca480172750000000000",
    "../evil",
    "a/b/c",
    "weird id!@$%^&*()",
  ]) {
    const url = buildPreapprovalUrl(id);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.host, "api.mercadopago.com");
    assert.ok(parsed.pathname.startsWith("/preapproval/"), id);
    const segmento = url.slice(url.indexOf("/preapproval/") + "/preapproval/".length);
    assert.equal(decodeURIComponent(segmento), id);
  }
});

// ---------------------------------------------------------------------------
// Mapeo preapproval.status -> QrSubscriptionStatus.
// ---------------------------------------------------------------------------

test("mapPreapprovalStatus: 'authorized' -> ACTIVE", () => {
  assert.equal(mapPreapprovalStatus("authorized"), "ACTIVE");
});

test("mapPreapprovalStatus: 'cancelled' y 'paused' -> INACTIVE", () => {
  assert.equal(mapPreapprovalStatus("cancelled"), "INACTIVE");
  assert.equal(mapPreapprovalStatus("paused"), "INACTIVE");
});

test("mapPreapprovalStatus: un estado desconocido -> null (se ignora, no se adivina)", () => {
  assert.equal(mapPreapprovalStatus("pending"), null);
  assert.equal(mapPreapprovalStatus(""), null);
});

// ---------------------------------------------------------------------------
// TF-005: la clave de idempotencia identifica a la notificación, no al recurso.
// ---------------------------------------------------------------------------

test("extractNotificationId lee el id de nivel superior de la notificación, como string", () => {
  assert.equal(extractNotificationId({ id: 123456789 }), "123456789");
  assert.equal(extractNotificationId({ id: "abc-123" }), "abc-123");
});

test("extractNotificationId devuelve null si falta el id", () => {
  assert.equal(extractNotificationId({}), null);
  assert.equal(extractNotificationId({ id: null }), null);
  assert.equal(extractNotificationId({ id: undefined }), null);
});

test("TF-005: dos notificaciones distintas sobre el mismo preapproval tienen claves distintas; la misma repetida, la misma clave", () => {
  const preapprovalId = "PA-123";
  const authorized = { id: 1001, type: "subscription_preapproval", data: { id: preapprovalId } };
  const cancelled = { id: 1002, type: "subscription_preapproval", data: { id: preapprovalId } };

  assert.notEqual(extractNotificationId(authorized), extractNotificationId(cancelled));
  assert.equal(extractNotificationId(authorized), extractNotificationId({ ...authorized }));
  // El bug original: keyear por data.id colapsaba las dos transiciones reales.
  assert.equal(authorized.data.id, cancelled.data.id);
});
