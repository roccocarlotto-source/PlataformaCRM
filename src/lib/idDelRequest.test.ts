import assert from "node:assert/strict";
import { test } from "node:test";
import { idDelRequest } from "./logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("OPS-09: sin X-Request-Id entrante, cada request lleva un UUID nuevo", () => {
  const uno = idDelRequest(undefined);
  assert.match(uno, UUID);
  assert.notEqual(idDelRequest(undefined), uno);
});

test("OPS-09: un X-Request-Id entrante con forma de id se respeta (para seguir un pedido entre servicios)", () => {
  assert.equal(idDelRequest("abc12345-rndr"), "abc12345-rndr");
});

test("OPS-09: un X-Request-Id entrante con cualquier otra cosa se reemplaza: no se escribe texto ajeno en el log", () => {
  for (const malo of [
    "corto",
    "con espacios adentro",
    "x".repeat(65),
    "a\nb-inyectado",
    ["a", "b"],
  ]) {
    assert.match(idDelRequest(malo), UUID, JSON.stringify(malo));
  }
});
