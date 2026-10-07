import assert from "node:assert/strict";
import { test } from "node:test";
import { armarCsv } from "./csvDeSalida";

// Los CSV del informe del asistente (decisión 18 y FABLE-I-06).

test("CSV: UTF-8 con BOM, separador «;» y fin de línea CRLF", () => {
  const csv = armarCsv(["Nombre", "Motivo"], [["Peña", "Falta el apellido"]]);
  assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(csv.toString("utf8").slice(1), "Nombre;Motivo\r\nPeña;Falta el apellido\r\n");
});

test("CSV: una celda con «;», comillas o salto de línea va entre comillas y duplica las internas", () => {
  const texto = armarCsv(["a"], [['dice "hola"; chau\nfin']])
    .toString("utf8")
    .slice(1);
  assert.equal(texto, 'a\r\n"dice ""hola""; chau\nfin"\r\n');
});

test("CSV: TODA celda que una planilla evaluaría como fórmula sale neutralizada, encabezados incluidos; números y vacíos no", () => {
  const texto = armarCsv(
    ["=Nombre"],
    [['=HYPERLINK("http://example.com")'], ["+598 99"], [-5], [null]],
  )
    .toString("utf8")
    .slice(1);
  const lineas = texto.split("\r\n");
  assert.equal(lineas[0], "'=Nombre");
  assert.equal(lineas[1], `"'=HYPERLINK(""http://example.com"")"`);
  assert.equal(lineas[2], "'+598 99");
  assert.equal(lineas[3], "-5");
  assert.equal(lineas[4], "");
});
