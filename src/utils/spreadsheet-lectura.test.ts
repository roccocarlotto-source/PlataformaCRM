import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { AppError } from "./AppError";
import {
  LIMITES_DEL_ASISTENTE,
  MAX_BYTES_DESCOMPRIMIDOS,
  MENSAJE_GUARDAR_COMO_XLSX,
  decodificarTexto,
  detectarSeparador,
  formatoDesdeNombre,
  parsearArchivo,
  revisarZip,
} from "./spreadsheet";

// ---------------------------------------------------------------------------
// Lectura ampliada para el asistente de importación
// (docs/importacion-de-datos.md §4.1 y §9.2): codificación y separador del
// CSV, hoja del XLSX, XLS/ODS con su mensaje, topes del asistente y la
// revisión del ZIP contra un zip bomb. Archivos armados acá, con datos
// inventados.
// ---------------------------------------------------------------------------

function esAppError(status: number, mensaje?: RegExp) {
  return (err: unknown) =>
    err instanceof AppError &&
    err.statusCode === status &&
    (mensaje === undefined || mensaje.test(err.message));
}

// "Muñoz;Peña" en Windows-1252: la ñ es un solo byte, 0xF1, que no es UTF-8
// válido.
function windows1252(texto: string): Buffer {
  const bytes: number[] = [];
  for (const c of texto) {
    const code = c.codePointAt(0) ?? 0;
    if (code > 0xff) throw new Error(`fuera de Latin-1: ${c}`);
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Codificación
// ---------------------------------------------------------------------------

test("codificación: UTF-8 cuando los bytes lo son; Windows-1252 cuando no (un CSV de Excel en Windows)", async () => {
  assert.equal(decodificarTexto(Buffer.from("Peña", "utf8")).codificacion, "utf-8");
  const latino = decodificarTexto(windows1252("Peña"));
  assert.equal(latino.codificacion, "windows-1252");
  assert.equal(latino.texto, "Peña");

  const parseado = await parsearArchivo(
    windows1252("Nombre;Apellido\nJosé;Muñoz\nInés;Peña\n"),
    "csv",
  );
  assert.deepEqual(parseado.filas, [
    { Nombre: "José", Apellido: "Muñoz" },
    { Nombre: "Inés", Apellido: "Peña" },
  ]);
  assert.deepEqual(parseado.lectura, { separador: ";", codificacion: "windows-1252" });
});

test("codificación forzada: un UTF-8 leído como Windows-1252 da el «Ã±» que el admin reconoce, y al revés se corrige", async () => {
  const utf8 = Buffer.from("Nombre\nPeña\n", "utf8");
  const mal = await parsearArchivo(utf8, "csv", { codificacion: "windows-1252" });
  assert.equal(mal.filas[0].Nombre, "PeÃ±a");
  const bien = await parsearArchivo(utf8, "csv", { codificacion: "utf-8" });
  assert.equal(bien.filas[0].Nombre, "Peña");
});

test("codificación: el BOM UTF-8 sigue sin contaminar el primer encabezado", async () => {
  const conBom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("Nombre;Mail\nAna;a@example.com\n"),
  ]);
  const parseado = await parsearArchivo(conBom, "csv");
  assert.deepEqual(parseado.encabezados, ["Nombre", "Mail"]);
});

// ---------------------------------------------------------------------------
// Separador
// ---------------------------------------------------------------------------

test("separador: punto y coma, tabulador y barra se detectan; la coma sigue siendo la de siempre", () => {
  assert.equal(detectarSeparador("a;b;c\n1;2;3\n"), ";");
  assert.equal(detectarSeparador("a\tb\n1\t2\n"), "\t");
  assert.equal(detectarSeparador("a|b\n1|2\n"), "|");
  assert.equal(detectarSeparador("a,b\n1,2\n"), ",");
});

test("separador: las comas DENTRO de comillas no confunden a un CSV con punto y coma", () => {
  const texto =
    'Nombre;Notas\n"Ana";"llamar el lunes, o el martes, a la tarde"\n"Beto";"x, y, z"\n';
  assert.equal(detectarSeparador(texto), ";");
});

test("separador: ante un empate gana la coma; con una sola columna, coma", () => {
  // Las dos dan dos columnas en todas las líneas.
  assert.equal(detectarSeparador("a,b;c\n1,2;3\n"), ",");
  assert.equal(detectarSeparador("Nombre\nAna\nBeto\n"), ",");
});

test("separador forzado: se respeta aunque la detección dijera otra cosa", async () => {
  const parseado = await parsearArchivo(Buffer.from("a;b\n1;2\n"), "csv", { separador: "," });
  assert.deepEqual(parseado.encabezados, ["a;b"]);
});

// ---------------------------------------------------------------------------
// Hoja
// ---------------------------------------------------------------------------

async function libroDeDosHojas(): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const a = libro.addWorksheet("Contactos");
  a.addRow(["Nombre"]);
  a.addRow(["Ana"]);
  const b = libro.addWorksheet("Stock");
  b.addRow(["Marca", "Modelo"]);
  b.addRow(["Marca Ficticia", "Modelo X"]);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

test("hoja: sin elegir, la primera (como siempre), y la lectura lista todas", async () => {
  const parseado = await parsearArchivo(await libroDeDosHojas(), "xlsx");
  assert.deepEqual(parseado.encabezados, ["Nombre"]);
  assert.deepEqual(parseado.lectura, { hojas: ["Contactos", "Stock"], hoja: "Contactos" });
});

test("hoja: se elige por nombre; una que no existe es 400 con la lista", async () => {
  const buffer = await libroDeDosHojas();
  const stock = await parsearArchivo(buffer, "xlsx", { hoja: "Stock" });
  assert.deepEqual(stock.filas, [{ Marca: "Marca Ficticia", Modelo: "Modelo X" }]);
  await assert.rejects(
    parsearArchivo(buffer, "xlsx", { hoja: "Ventas" }),
    esAppError(400, /no tiene una hoja «Ventas».*Contactos, Stock/),
  );
});

// ---------------------------------------------------------------------------
// XLS y ODS (decisión 2)
// ---------------------------------------------------------------------------

test("XLS y ODS: 415 con el mensaje que dice qué hacer", () => {
  for (const nombre of ["clientes.xls", "CLIENTES.XLS", "stock.ods"]) {
    assert.throws(
      () => formatoDesdeNombre(nombre),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 415 &&
        err.message.includes(MENSAJE_GUARDAR_COMO_XLSX),
      nombre,
    );
  }
  assert.equal(MENSAJE_GUARDAR_COMO_XLSX, "Guardalo como .xlsx o .csv y volvé a subirlo");
});

// ---------------------------------------------------------------------------
// Topes del asistente: solo si se piden
// ---------------------------------------------------------------------------

test("topes: una celda gigante rechaza el archivo con fila y columna; sin topes (POST /api/imports) entra como antes", async () => {
  const largo = "x".repeat(LIMITES_DEL_ASISTENTE.maxCaracteresPorCelda + 1);
  const buffer = Buffer.from(`Nombre,Notas\nAna,corta\nBeto,${largo}\n`);
  await assert.rejects(
    parsearArchivo(buffer, "csv", { limites: LIMITES_DEL_ASISTENTE }),
    esAppError(400, /La fila 2, columna «Notas», tiene 10001 caracteres/),
  );
  const sinTopes = await parsearArchivo(buffer, "csv");
  assert.equal(sinTopes.filas.length, 2);
});

test("topes: más columnas que el máximo, o una fila que serializada pasa los 64 KB, rechazan el archivo", async () => {
  const muchas = Array.from({ length: LIMITES_DEL_ASISTENTE.maxColumnas + 1 }, (_, i) => `c${i}`);
  await assert.rejects(
    parsearArchivo(
      Buffer.from(`${muchas.join(",")}\n${muchas.map(() => "1").join(",")}\n`),
      "csv",
      {
        limites: LIMITES_DEL_ASISTENTE,
      },
    ),
    esAppError(400, /201 columnas \(máximo 200\)/),
  );

  // Diez celdas de 9.000 caracteres: cada una pasa el tope de celda, la fila
  // entera no.
  const columnas = Array.from({ length: 10 }, (_, i) => `n${i}`);
  const fila = columnas.map(() => "y".repeat(9_000));
  await assert.rejects(
    parsearArchivo(Buffer.from(`${columnas.join(",")}\n${fila.join(",")}\n`), "csv", {
      limites: LIMITES_DEL_ASISTENTE,
    }),
    esAppError(400, /La fila 1 ocupa \d+ KB \(máximo 64 KB\)/),
  );
});

// ---------------------------------------------------------------------------
// Zip bomb: el directorio central del XLSX
// ---------------------------------------------------------------------------

async function xlsxValido(): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Hoja");
  hoja.addRow(["Nombre"]);
  hoja.addRow(["Ana"]);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

function finDelDirectorio(buffer: Buffer): number {
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("sin fin de directorio");
}

function primeraEntrada(buffer: Buffer): number {
  return buffer.readUInt32LE(finDelDirectorio(buffer) + 16);
}

test("zip: un XLSX normal pasa la revisión y se lee", async () => {
  const buffer = await xlsxValido();
  assert.doesNotThrow(() => revisarZip(buffer));
  const parseado = await parsearArchivo(buffer, "xlsx");
  assert.equal(parseado.filas.length, 1);
});

test("zip: una entrada que declara expandirse más de 200 a 1 se rechaza antes de descomprimir", async () => {
  const buffer = await xlsxValido();
  buffer.writeUInt32LE(50 * 1024 * 1024, primeraEntrada(buffer) + 24);
  await assert.rejects(parsearArchivo(buffer, "xlsx"), esAppError(400, /se expande demasiado/));
});

test("zip: si la suma declarada pasa los 100 MB se rechaza, aunque ninguna entrada sola llame la atención", async () => {
  const buffer = await xlsxValido();
  const entrada = primeraEntrada(buffer);
  // Comprimido grande también, para que la proporción no salte primero.
  buffer.writeUInt32LE(MAX_BYTES_DESCOMPRIMIDOS, entrada + 20);
  buffer.writeUInt32LE(MAX_BYTES_DESCOMPRIMIDOS + 1, entrada + 24);
  assert.throws(() => revisarZip(buffer), esAppError(400, /más de 100 MB/));
});

test("zip: demasiadas entradas, ZIP64 o un archivo que no es ZIP se rechazan con 400", async () => {
  const muchas = await xlsxValido();
  muchas.writeUInt16LE(6_000, finDelDirectorio(muchas) + 10);
  assert.throws(() => revisarZip(muchas), esAppError(400, /6000 archivos internos/));

  const zip64 = await xlsxValido();
  zip64.writeUInt16LE(0xffff, finDelDirectorio(zip64) + 10);
  assert.throws(() => revisarZip(zip64), esAppError(400, /ZIP64/));

  assert.throws(
    () => revisarZip(Buffer.from("esto no es un zip")),
    esAppError(400, /no es un archivo \.xlsx válido/),
  );
});
