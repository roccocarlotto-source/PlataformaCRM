import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TIMESTAMP_AGE_SECONDS,
  MAX_TIMESTAMP_FUTURE_SKEW_SECONDS,
  buildManifest,
  hmacSha256Hex,
  isTimestampFresh,
  parseSignatureHeader,
  timingSafeEqual,
  verifyMercadoPagoSignature,
} from "./mercadopagoSignature";

// Puerto de Plataforma-QR/supabase/functions/_shared/mercadopago.test.ts (la
// parte de firma). El vector conocido del HMAC se calculó originalmente con
// crypto.createHmac de Node — o sea, exactamente lo que este archivo usa ahora.

test("parseSignatureHeader parsea un header bien formado", () => {
  assert.deepEqual(parseSignatureHeader("ts=1704908010,v1=abc123"), {
    ts: "1704908010",
    v1: "abc123",
  });
});

test("parseSignatureHeader devuelve null si falta un campo", () => {
  assert.equal(parseSignatureHeader("ts=1704908010"), null);
  assert.equal(parseSignatureHeader("v1=abc123"), null);
  assert.equal(parseSignatureHeader(""), null);
  assert.equal(parseSignatureHeader(null), null);
  assert.equal(parseSignatureHeader(undefined), null);
});

test("buildManifest sigue el formato documentado por MercadoPago", () => {
  assert.equal(
    buildManifest("123456", "req-abc", "1704908010"),
    "id:123456;request-id:req-abc;ts:1704908010;",
  );
});

test("hmacSha256Hex produce el digest esperado para un vector conocido", () => {
  assert.equal(
    hmacSha256Hex("test_secret", "id:123456;request-id:req-abc;ts:1704908010;"),
    "e261829008c66364e666d4d671c965b9671fcd03ed82cc7ae0cd77a0511424b9",
  );
});

test("timingSafeEqual: iguales sí, distintos no, largos distintos no, y nunca tira", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

// nowMs fijado en el propio `ts` en los tests de firma, para que un `ts`
// precalculado no falle por frescura a medida que pasa el tiempo real.
test("verifyMercadoPagoSignature acepta un request bien firmado", () => {
  const secret = "test_secret";
  const dataId = "123456";
  const requestId = "req-abc";
  const ts = "1704908010";
  const v1 = hmacSha256Hex(secret, buildManifest(dataId, requestId, ts));

  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId,
      secret,
      nowMs: Number(ts) * 1000,
    }),
    true,
  );
});

test("verifyMercadoPagoSignature rechaza un data.id manipulado (webhook falsificado)", () => {
  const secret = "test_secret";
  const ts = "1704908010";
  const requestId = "req-abc";
  const v1 = hmacSha256Hex(secret, buildManifest("999999", requestId, ts));

  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId: "123456",
      secret,
      nowMs: Number(ts) * 1000,
    }),
    false,
  );
});

test("verifyMercadoPagoSignature rechaza cuando el secreto no coincide", () => {
  const ts = "1704908010";
  const requestId = "req-abc";
  const dataId = "123456";
  const v1 = hmacSha256Hex("wrong_secret", buildManifest(dataId, requestId, ts));

  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId,
      secret: "test_secret",
      nowMs: Number(ts) * 1000,
    }),
    false,
  );
});

test("verifyMercadoPagoSignature rechaza header ausente, request-id ausente y data.id vacío", () => {
  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: null,
      requestId: "req-abc",
      dataId: "123456",
      secret: "test_secret",
    }),
    false,
  );
  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: "ts=1,v1=abc",
      requestId: undefined,
      dataId: "123456",
      secret: "test_secret",
    }),
    false,
  );
  assert.equal(
    verifyMercadoPagoSignature({
      signatureHeader: "ts=1,v1=abc",
      requestId: "req-abc",
      dataId: "",
      secret: "test_secret",
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// AUD-04 original: frescura del timestamp (anti-replay).
// ---------------------------------------------------------------------------

const NOW_MS = 1_800_000_000_000;
const nowSeconds = Math.floor(NOW_MS / 1000);

function firmado(ts: string) {
  const secret = "test_secret";
  const dataId = "123456";
  const requestId = "req-abc";
  const v1 = hmacSha256Hex(secret, buildManifest(dataId, requestId, ts));
  return verifyMercadoPagoSignature({
    signatureHeader: `ts=${ts},v1=${v1}`,
    requestId,
    dataId,
    secret,
    nowMs: NOW_MS,
  });
}

test("firma válida con timestamp reciente: aceptada", () => {
  assert.equal(firmado(String(nowSeconds - 10)), true);
});

test("firma válida pero timestamp vencido (replay): rechazada", () => {
  assert.equal(firmado(String(nowSeconds - (MAX_TIMESTAMP_AGE_SECONDS + 1))), false);
});

test("firma válida pero timestamp demasiado en el futuro: rechazada", () => {
  assert.equal(firmado(String(nowSeconds + MAX_TIMESTAMP_FUTURE_SKEW_SECONDS + 1)), false);
});

test("isTimestampFresh: bordes inclusivos y un segundo afuera", () => {
  assert.equal(isTimestampFresh(String(nowSeconds - 30), NOW_MS), true);
  assert.equal(isTimestampFresh(String(nowSeconds - MAX_TIMESTAMP_AGE_SECONDS), NOW_MS), true);
  assert.equal(isTimestampFresh(String(nowSeconds - MAX_TIMESTAMP_AGE_SECONDS - 1), NOW_MS), false);
  assert.equal(
    isTimestampFresh(String(nowSeconds + MAX_TIMESTAMP_FUTURE_SKEW_SECONDS), NOW_MS),
    true,
  );
  assert.equal(
    isTimestampFresh(String(nowSeconds + MAX_TIMESTAMP_FUTURE_SKEW_SECONDS + 1), NOW_MS),
    false,
  );
});

test("isTimestampFresh rechaza strings no numéricos, NaN e Infinity sin tirar", () => {
  for (const ts of ["not-a-number", "", "123abc", "NaN", "Infinity", "-Infinity"]) {
    assert.equal(isTimestampFresh(ts, NOW_MS), false, ts);
  }
});
