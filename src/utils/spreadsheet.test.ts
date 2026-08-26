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
  const parseado = await parsearArchivo(csv("Nombre,Mail,\nAna,ana@ejemplo.test,\n"), "csv");

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

// DECISIÓN: SE GENERAN LAS 10.000 FILAS DE VERDAD, sin exponer el tope como
// parámetro inyectable ni bajarlo para el test.
//
// La alternativa era darle a parsearArchivo un `maxFilas` opcional para poder
// probar el rechazo con 3 filas. Se descartó por dos razones, y la segunda es
// la que decide:
//
//   1. Cuesta nada. Armar y parsear 10.005 filas tarda ~15 ms — tres órdenes de
//      magnitud menos que cualquier test de integración de este proyecto. El
//      problema que ese parámetro resolvería no existe.
//   2. Un `maxFilas` inyectable haría que el test NO PRUEBE la constante real.
//      Pasaría igual si MAX_FILAS_POR_ARCHIVO se cambiara a 10 o a 10 millones,
//      que es justamente el valor cuyo efecto se quiere fijar. Una costura que
//      solo existe para los tests y que además afloja lo que el test afirma es
//      peor que el costo que evita.
//
// El test importa la constante en vez de repetir el 10.000: si el tope cambia,
// el test sigue siendo válido sin tocarlo.
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
// XLSX: normalización de celdas que NO son primitivos
//
// Una celda de Excel puede llegar como objeto de exceljs —texto enriquecido,
// hipervínculo, fórmula—. Guardar esos objetos crudos en el JSONB no conservaría
// más información, solo la haría ilegible: `[object Object]` o un árbol de runs
// de formato del que después nadie puede sacar el mail. Lo que se normaliza es
// CÓMO SE REPRESENTA el valor; el NOMBRE de la columna sigue intacto, que es lo
// único que el fieldMapping puede corregir más tarde.
// ---------------------------------------------------------------------------

test("una celda de TEXTO ENRIQUECIDO se aplana al texto que la persona ve", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Mail"]);
  const fila = hoja.addRow([]);
  // Media celda en negrita: es lo que produce pegar desde Word o resaltar a
  // mano una parte del nombre, y no debería cambiar en nada el dato importado.
  fila.getCell(1).value = {
    richText: [{ font: { bold: true }, text: "Ana" }, { text: " Gómez" }],
  };
  fila.getCell(2).value = "ana@ejemplo.test";
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.deepEqual(parseado.filas, [{ Nombre: "Ana Gómez", Mail: "ana@ejemplo.test" }]);
});

test("una celda de FÓRMULA guarda su RESULTADO, no la fórmula", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Mail"]);
  const fila = hoja.addRow([]);
  fila.getCell(1).value = "Ana";
  // Concatenar usuario y dominio en una columna es de lo más común en una
  // planilla armada a mano. Guardar 'CONCATENATE(...)' en vez del mail haría
  // fallar la promoción con un motivo incomprensible.
  fila.getCell(2).value = {
    formula: 'CONCATENATE("ana","@ejemplo.test")',
    result: "ana@ejemplo.test",
  };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.deepEqual(parseado.filas, [{ Nombre: "Ana", Mail: "ana@ejemplo.test" }]);
});

test("una celda con HIPERVÍNCULO guarda el texto visible, no el objeto", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Mail"]);
  const fila = hoja.addRow([]);
  fila.getCell(1).value = "Ana";
  // Excel convierte solo cualquier cosa que parezca un mail en un mailto:.
  fila.getCell(2).value = {
    text: "ana@ejemplo.test",
    hyperlink: "mailto:ana@ejemplo.test",
  };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.equal(parseado.filas[0].Mail, "ana@ejemplo.test");
});

test("SOLO SE LEE LA PRIMERA HOJA del libro, y las demás se ignoran enteras", async () => {
  const workbook = new ExcelJS.Workbook();

  const primera = workbook.addWorksheet("Leads");
  primera.addRow(["Nombre", "Mail"]);
  primera.addRow(["Ana", "ana@ejemplo.test"]);

  // Otra hoja con OTROS encabezados: es el caso normal de un libro real (una
  // hoja de leads y otra de notas o totales). Concatenarlas produciría filas
  // con los encabezados de la hoja equivocada.
  const segunda = workbook.addWorksheet("Notas");
  segunda.addRow(["Comentario", "Autor"]);
  segunda.addRow(["revisar", "Beto"]);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parseado = await parsearArchivo(buffer, "xlsx");

  assert.deepEqual(parseado.encabezados, ["Nombre", "Mail"]);
  assert.deepEqual(parseado.filas, [{ Nombre: "Ana", Mail: "ana@ejemplo.test" }]);
  // Ni el encabezado ni el dato de la segunda hoja se filtran.
  assert.equal(parseado.filas.length, 1);
  assert.ok(!("Comentario" in parseado.filas[0]));
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
