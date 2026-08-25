import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { AppError } from "./AppError";
import { deriveExternalId } from "./externalId";
import {
  MAX_FILAS_POR_ARCHIVO,
  filasParaStaging,
  formatoDesdeNombre,
  parsearArchivo,
} from "./spreadsheet";

const csv = (texto: string) => Buffer.from(texto, "utf8");

// ---------------------------------------------------------------------------
// EL INVARIANTE CENTRAL DEL ÍTEM 5
// ---------------------------------------------------------------------------

test("LOS ENCABEZADOS NO SE TRADUCEN: las filas salen con las claves del archivo", async () => {
  const parseado = await parsearArchivo(
    csv("Nombre,Apellido,Mail\nAna,Gómez,ana@ejemplo.test\n"),
    "csv",
  );

  // Las claves son las del ARCHIVO, no firstName/lastName/email. Si esto
  // cambiara, un mapeo mal configurado dejaría de ser corregible y §1 —"corregir
  // un mapeo y volver a correrlo"— sería falso.
  assert.deepEqual(parseado.filas, [
    { Nombre: "Ana", Apellido: "Gómez", Mail: "ana@ejemplo.test" },
  ]);
  assert.deepEqual(parseado.encabezados, ["Nombre", "Apellido", "Mail"]);
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test("el BOM de un CSV exportado por Excel no contamina el primer encabezado", async () => {
  // Sin bom: true el primer encabezado llegaría como "﻿Nombre" y NINGÚN
  // mapeo lo encontraría jamás — con el agravante de que el archivo se ve bien.
  const conBom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    csv("Nombre,Mail\nAna,ana@ejemplo.test\n"),
  ]);

  const parseado = await parsearArchivo(conBom, "csv");

  assert.deepEqual(parseado.encabezados, ["Nombre", "Mail"]);
  assert.equal(parseado.filas[0].Nombre, "Ana");
});

test("una fila con menos o más columnas que el encabezado NO aborta el archivo", async () => {
  const parseado = await parsearArchivo(
    csv("Nombre,Mail\nAna,ana@ejemplo.test\nCorta\nLarga,larga@ejemplo.test,sobra\n"),
    "csv",
  );

  // Las tres entran. §5: la fila mala se marca cuando el worker la mire, no se
  // pierde el archivo entero en el parseo.
  assert.equal(parseado.filas.length, 3);
  assert.equal(parseado.filas[1].Mail, null);
});

test("las filas totalmente vacías se descartan", async () => {
  const parseado = await parsearArchivo(
    csv("Nombre,Mail\nAna,ana@ejemplo.test\n,\n\nBeto,beto@ejemplo.test\n"),
    "csv",
  );

  assert.equal(parseado.filas.length, 2);
});

test("las columnas sin encabezado se ignoran en vez de invalidar el archivo", async () => {
  // Una coma de más al final es lo que produce cualquier planilla real.
  const parseado = await parsearArchivo(
    csv("Nombre,Mail,\nAna,ana@ejemplo.test,\n"),
    "csv",
  );

  assert.deepEqual(parseado.encabezados, ["Nombre", "Mail"]);
  assert.deepEqual(parseado.filas, [{ Nombre: "Ana", Mail: "ana@ejemplo.test" }]);
});

test("los encabezados REPETIDOS sí invalidan el archivo: una columna desaparecería", async () => {
  await assert.rejects(
    () => parsearArchivo(csv("Mail,Mail\na@b.com,c@d.com\n"), "csv"),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un archivo sin filas de datos se rechaza", async () => {
  await assert.rejects(
    () => parsearArchivo(csv("Nombre,Mail\n"), "csv"),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test("un archivo con más filas que el máximo se rechaza en vez de truncarse", async () => {
  const lineas = ["Nombre,Mail"];
  for (let i = 0; i < MAX_FILAS_POR_ARCHIVO + 5; i++) {
    lineas.push(`Persona${i},p${i}@ejemplo.test`);
  }

  // Truncar en silencio es el modo de falla peligroso: un archivo recortado se
  // ve exactamente igual que uno importado entero.
  await assert.rejects(
    () => parsearArchivo(csv(lineas.join("\n")), "csv"),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

test("el formato se decide por la extensión, y lo no soportado da 415", () => {
  assert.equal(formatoDesdeNombre("leads.csv"), "csv");
  assert.equal(formatoDesdeNombre("LEADS.CSV"), "csv");
  assert.equal(formatoDesdeNombre("feria marzo.xlsx"), "xlsx");

  for (const nombre of ["leads.txt", "leads.xls", "leads.json", "leads"]) {
    assert.throws(
      () => formatoDesdeNombre(nombre),
      (err: unknown) => err instanceof AppError && err.statusCode === 415,
      `${nombre} no debería aceptarse`,
    );
  }
});

// Este test faltaba y su ausencia costó caro: los unitarios solo cubrían el
// XLSX INVÁLIDO (que da 400 por cualquier motivo, incluido uno equivocado), así
// que un bug en el camino feliz solo aparecía en el test de integración, con
// base de datos y HTTP de por medio. El camino que funciona necesita su propia
// prueba, no alcanza con probar que el roto falla.
test("un XLSX VÁLIDO se parsea, y tampoco traduce encabezados", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Apellido", "Mail"]);
  hoja.addRow(["Ana", "Gómez", "ana@ejemplo.test"]);
  hoja.addRow(["Beto", "Pérez", "beto@ejemplo.test"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.deepEqual(parseado.encabezados, ["Nombre", "Apellido", "Mail"]);
  assert.equal(parseado.filas.length, 2);
  assert.deepEqual(parseado.filas[0], {
    Nombre: "Ana",
    Apellido: "Gómez",
    Mail: "ana@ejemplo.test",
  });
});

test("un XLSX con números y fechas normaliza el VALOR de la celda, nunca el nombre de la columna", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Teléfono", "Alta"]);
  hoja.addRow(["Ana", 541100000, new Date(Date.UTC(2026, 2, 15))]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.deepEqual(parseado.encabezados, ["Nombre", "Teléfono", "Alta"]);
  assert.equal(parseado.filas[0]["Teléfono"], 541100000);
  assert.equal(parseado.filas[0]["Alta"], "2026-03-15T00:00:00.000Z");
});

test("un .xlsx que en realidad no es un Excel da 400, no una excepción cruda", async () => {
  await assert.rejects(
    () => parsearArchivo(csv("esto no es un zip"), "xlsx"),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

// ---------------------------------------------------------------------------
// externalId por fila
// ---------------------------------------------------------------------------

test("dos filas IDÉNTICAS del mismo archivo producen externalId distintos", () => {
  const filas = filasParaStaging([
    { Nombre: "Ana", Mail: "ana@ejemplo.test" },
    { Nombre: "Ana", Mail: "ana@ejemplo.test" },
  ]);

  // Sin el número de fila en la derivación, estas dos colapsarían en un solo
  // evento por el único (source_id, external_id) y se perdería un lead sin que
  // nada lo dijera.
  assert.notEqual(filas[0].externalId, filas[1].externalId);
});

test("el MISMO archivo produce los MISMOS externalId — subirlo dos veces no duplica", () => {
  const contenido = [
    { Nombre: "Ana", Mail: "ana@ejemplo.test" },
    { Nombre: "Beto", Mail: "beto@ejemplo.test" },
  ];

  const primera = filasParaStaging(contenido);
  const segunda = filasParaStaging(contenido.map((f) => ({ ...f })));

  assert.deepEqual(
    primera.map((f) => f.externalId),
    segunda.map((f) => f.externalId),
    "§4: un Excel que se sube dos veces no puede duplicar",
  );
});

test("el externalId reusa deriveExternalId sobre { fila, datos }, sin una segunda forma de hashear", () => {
  const fila = { Nombre: "Ana" };
  const [primera] = filasParaStaging([fila]);

  assert.equal(primera.externalId, deriveExternalId({ fila: 1, datos: fila }));
});

test("el rawPayload de cada fila es la fila cruda, sin tocar", () => {
  const filas = [{ Nombre: "Ana", "Columna rara": "x" }];
  const [primera] = filasParaStaging(filas);

  assert.deepEqual(primera.rawPayload, filas[0]);
});
