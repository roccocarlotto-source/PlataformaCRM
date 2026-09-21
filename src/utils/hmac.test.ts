import assert from "node:assert/strict";
import { test } from "node:test";
import { hmacSha256Hex, timingSafeEqual } from "./hmac";

test("hmacSha256Hex produce el digest esperado para un vector conocido", () => {
  assert.equal(
    hmacSha256Hex("test_secret", "id:123456;request-id:req-abc;ts:1704908010;"),
    "e261829008c66364e666d4d671c965b9671fcd03ed82cc7ae0cd77a0511424b9",
  );
});

test("hmacSha256Hex: un Buffer da el mismo digest que su string UTF-8", () => {
  const texto = '{"hola":"ñandú"}';
  assert.equal(hmacSha256Hex("s", Buffer.from(texto, "utf8")), hmacSha256Hex("s", texto));
});

test("timingSafeEqual: iguales sí, distintos no, largos distintos no, y nunca tira", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});
