import assert from "node:assert/strict";
import { test } from "node:test";
import { linksDeLaCelda, TOPES_DE_FOTOS } from "./importacionFotos.service";

// docs/importacion-de-datos.md §6 y decisión 13.

test("linksDeLaCelda: separados por espacios, comas, punto y coma, barras o saltos de línea; sin repetidos y en orden", () => {
  assert.deepEqual(
    linksDeLaCelda(
      "https://a.example.com/1.jpg, https://a.example.com/2.jpg;https://a.example.com/3.jpg | https://a.example.com/1.jpg\nhttps://a.example.com/4.jpg",
    ),
    [
      "https://a.example.com/1.jpg",
      "https://a.example.com/2.jpg",
      "https://a.example.com/3.jpg",
      "https://a.example.com/4.jpg",
    ],
  );
  assert.deepEqual(linksDeLaCelda(undefined), []);
  assert.deepEqual(linksDeLaCelda("  "), []);
});

test("los topes de la decisión 13 y los del lote propuestos en §6", () => {
  assert.equal(TOPES_DE_FOTOS.porVehiculo, 20);
  assert.equal(TOPES_DE_FOTOS.bytesPorFoto, 5 * 1024 * 1024);
  assert.equal(TOPES_DE_FOTOS.timeoutMs, 15_000);
  assert.equal(TOPES_DE_FOTOS.porLote, 3_000);
  assert.equal(TOPES_DE_FOTOS.bytesPorLote, 1_500 * 1024 * 1024);
});
