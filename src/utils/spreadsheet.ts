import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { AppError } from "./AppError";
import { deriveExternalId } from "./externalId";

// ---------------------------------------------------------------------------
// Parseo de CSV/XLSX a filas crudas (ítem 5 de docs/ingestion-architecture.md).
//
// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTE MÓDULO **NO** HACE, Y ES SU PROPIEDAD MÁS IMPORTANTE:
// NO TRADUCE ENCABEZADOS.
//
// Devuelve cada fila con las claves ORIGINALES del archivo —"Nombre", "Mail",
// lo que sea que use esa fuente— y eso es lo que termina en
// IngestionEvent.rawPayload. `fieldMapping` NO se consulta acá: se aplica
// después, dentro de la promoción.
//
// La razón es el principio rector de §1, literal: la ventaja del staging es
// poder "corregir un mapeo y volver a correrlo". Si lo guardado ya viniera
// traducido, un mapeo mal configurado sería IRREVERSIBLE — habría que pedirle
// el archivo de nuevo a quien lo subió, y para un Excel de una feria de hace
// tres meses eso significa que el dato se perdió.
// ═══════════════════════════════════════════════════════════════════════════
//
// LO QUE SÍ HACE, y por qué no es lo mismo: normaliza el VALOR de cada celda a
// un primitivo JSON (string, number, boolean o null). Una celda de Excel puede
// venir como texto enriquecido, hipervínculo o resultado de fórmula, que son
// objetos de la librería sin sentido fuera de ella: guardarlos crudos en un
// JSONB no conservaría más información, solo la haría ilegible. La distinción
// es la que importa: se normaliza cómo se REPRESENTA un valor, nunca CÓMO SE
// LLAMA la columna, que es lo único que el mapeo puede corregir después.
// ---------------------------------------------------------------------------

// Tope de filas por archivo. No es una regla de negocio: acota cuánto puede
// crecer una sola importación, tanto en memoria durante el parseo como en filas
// escritas en la tabla de mayor volumen del esquema.
//
// §5 usa "un Excel de 5.000 filas" como el caso grande que motiva el diseño;
// 10.000 deja el doble de margen. Superarlo se rechaza con un mensaje explícito
// en vez de truncar, que es el modo de falla peligroso: un archivo recortado en
// silencio se ve exactamente igual que uno importado entero.
export const MAX_FILAS_POR_ARCHIVO = 10_000;

// Tope del archivo subido. Más grande que los 64 KB del webhook (§ítem 4)
// porque acá el cuerpo es un archivo con miles de filas, no un formulario.
//
// 10 MB cubre con holgura un CSV de 10.000 filas (unos 2 MB con columnas
// típicas) y un XLSX equivalente. No se puso más alto por una razón concreta:
// un XLSX es un ZIP, así que su tamaño comprimido NO acota lo que ocupa al
// expandirse, y este tope es la única barrera que hay contra eso — ver el
// comentario de parsearXlsx, que explica por qué la mitigación por streaming no
// se pudo aplicar y qué riesgo queda en pie.
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ValorDeCelda = string | number | boolean | null;
export type FilaCruda = Record<string, ValorDeCelda>;

export interface ArchivoParseado {
  // Encabezados tal como venían, en orden. Se devuelven para que el endpoint
  // pueda decirle al ADMIN qué columnas se detectaron: sin eso, un mapeo que no
  // matchea ninguna columna es imposible de diagnosticar.
  encabezados: string[];
  filas: FilaCruda[];
  lectura: LecturaDelArchivo;
}

// Una fila lista para escribirse en staging.
export interface FilaParaStaging {
  externalId: string;
  rawPayload: FilaCruda;
}

// ---------------------------------------------------------------------------
// OPCIONES DE LECTURA (importación de datos, docs/importacion-de-datos.md
// §4.1). Las dos rutas —POST /api/imports y el asistente de Plataforma— leen
// con ESTAS funciones (§9.11: un solo parser). Lo que cambia entre ellas es
// solo lo que se pasa acá:
//
//   - separador y codificación del CSV: si no se fijan, se DETECTAN, en las
//     dos rutas. Un Excel en español exporta con ";" y en Windows-1252, y eso
//     antes llegaba como una sola columna o con "Ã±" en los nombres. La
//     detección prefiere la coma ante un empate, así que un CSV que antes se
//     leía bien se sigue leyendo igual.
//   - hoja de un XLSX: por nombre; sin ella, la primera, como siempre.
//   - límites: el asistente pasa LIMITES_DEL_ASISTENTE. POST /api/imports no
//     pasa ninguno y se comporta como antes: un tope nuevo ahí podría
//     rechazar un archivo que hasta ayer entraba.
// ---------------------------------------------------------------------------

export const SEPARADORES = [",", ";", "\t", "|"] as const;
export type Separador = (typeof SEPARADORES)[number];

export const CODIFICACIONES = ["utf-8", "windows-1252"] as const;
export type Codificacion = (typeof CODIFICACIONES)[number];

export interface LimitesDeLectura {
  maxColumnas: number;
  maxCaracteresPorCelda: number;
  // La fila serializada como JSON, que es lo que se guarda en rawPayload.
  // Mismo tope que el payload del webhook.
  maxBytesPorFila: number;
}

export const LIMITES_DEL_ASISTENTE: LimitesDeLectura = {
  maxColumnas: 200,
  maxCaracteresPorCelda: 10_000,
  maxBytesPorFila: 64 * 1024,
};

export interface OpcionesDeLectura {
  separador?: Separador;
  codificacion?: Codificacion;
  hoja?: string;
  limites?: LimitesDeLectura;
}

// Cómo se leyó el archivo: lo que el asistente le muestra al admin en el paso
// de ajustes para que pueda corregirlo ("Ã±" en los nombres = codificación
// equivocada).
export interface LecturaDelArchivo {
  separador?: Separador;
  codificacion?: Codificacion;
  // Todas las hojas del libro, en orden, y la que se leyó.
  hojas?: string[];
  hoja?: string;
}

function normalizarCelda(valor: unknown): ValorDeCelda {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  if (valor instanceof Date) {
    // ISO 8601: estable, ordenable y sin ambigüedad de zona horaria o de
    // formato regional (03/04 no dice si es marzo o abril).
    return valor.toISOString();
  }
  // Texto enriquecido, hipervínculo, fórmula: exceljs expone la representación
  // textual en propiedades conocidas. Se prefiere `text` (lo que la persona ve
  // en la celda) y, para una fórmula, su resultado calculado.
  if (typeof valor === "object") {
    const obj = valor as { text?: unknown; result?: unknown; richText?: unknown; error?: unknown };
    if (typeof obj.text === "string") {
      return obj.text;
    }
    if (obj.result !== undefined) {
      return normalizarCelda(obj.result);
    }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((parte) => (parte as { text?: string }).text ?? "").join("");
    }
    // Una fórmula que falla: exceljs pone en `result` un CellErrorValue,
    // `{ error: "#N/A" }` (o "#DIV/0!", "#REF!", …). Sin esta rama, la llamada
    // recursiva de arriba caía al String(valor) final y guardaba literalmente
    // "[object Object]" — silencioso e indistinguible de un valor real (B-29 de
    // docs-privados/auditoria-2026-08-29.md (local, no está en GitHub)). Se guarda el código de error tal cual: es
    // exactamente lo que la persona ve en la celda, mismo criterio que `text`.
    if (typeof obj.error === "string") {
      return obj.error;
    }
  }
  return String(valor);
}

// Los encabezados se validan una sola vez, antes de armar ninguna fila.
function validarEncabezados(crudos: unknown[]): string[] {
  const encabezados = crudos.map((valor) => {
    const normalizado = normalizarCelda(valor);
    return normalizado === null ? "" : String(normalizado).trim();
  });

  // Se ignoran las columnas SIN encabezado en vez de rechazar el archivo: una
  // columna vacía al final es lo que produce cualquier planilla con una coma de
  // más o una celda tocada sin querer, y sería absurdo que eso invalide una
  // importación de 5.000 filas.
  const conNombre = encabezados.filter((h) => h !== "");

  if (conNombre.length === 0) {
    throw new AppError(
      "El archivo no tiene encabezados: la primera fila tiene que ser la de los nombres de columna",
      400,
    );
  }

  // Los encabezados repetidos SÍ invalidan el archivo. Un objeto JSON no puede
  // tener la clave dos veces, así que una de las dos columnas desaparecería —
  // en silencio, y sin forma de saber cuál. Un 400 al subir es mejor que la
  // mitad de los datos evaporados.
  const repetidos = [...new Set(conNombre.filter((h, i) => conNombre.indexOf(h) !== i))];
  if (repetidos.length > 0) {
    throw new AppError(
      `El archivo tiene encabezados repetidos y no se puede saber cuál es cuál: ${repetidos.join(", ")}`,
      400,
    );
  }

  return encabezados;
}

function armarFila(encabezados: string[], celdas: unknown[]): FilaCruda {
  const fila: FilaCruda = {};
  encabezados.forEach((encabezado, i) => {
    if (encabezado === "") {
      return; // columna sin nombre: se ignora, ver validarEncabezados
    }
    // defineProperty Y NO `fila[encabezado] = …` — B-28 de
    // docs-privados/auditoria-2026-08-29.md (local, no está en GitHub). Sobre un objeto normal, la asignación con
    // la clave literal "__proto__" no crea una propiedad: dispara el setter
    // heredado de Object.prototype y esa columna se pierde en silencio para
    // TODAS las filas del archivo. defineProperty crea la propiedad propia
    // siempre, sea cual sea el nombre. Se eligió esto y no un objeto sin
    // prototipo (Object.create(null), como en canonicalize) porque esta fila
    // NO es local: es el rawPayload que viaja a Prisma como JSONB y que
    // promotion.service.ts vuelve a leer — cambiarle el prototipo es un riesgo
    // más difuso que el propio hallazgo. Enumerable/writable/configurable
    // como una propiedad común: para Object.values, JSON.stringify y quien
    // lea la fila después, no hay diferencia con una asignación.
    Object.defineProperty(fila, encabezado, {
      value: normalizarCelda(celdas[i]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return fila;
}

function estaVacia(fila: FilaCruda): boolean {
  return Object.values(fila).every(
    (valor) => valor === null || (typeof valor === "string" && valor.trim() === ""),
  );
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// La codificación: UTF-8 si los bytes lo son (decodificar en modo estricto
// falla ante la primera secuencia inválida), y si no Windows-1252, que es lo
// que exporta Excel en Windows y cubre Latin-1 en todos los caracteres
// imprimibles. Node trae ICU completo, así que no hace falta una librería.
// TextDecoder saca el BOM UTF-8 solo.
export function decodificarTexto(
  buffer: Buffer,
  forzada?: Codificacion,
): { texto: string; codificacion: Codificacion } {
  if (forzada) {
    return { texto: new TextDecoder(forzada).decode(buffer), codificacion: forzada };
  }
  try {
    return {
      texto: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      codificacion: "utf-8",
    };
  } catch {
    return { texto: new TextDecoder("windows-1252").decode(buffer), codificacion: "windows-1252" };
  }
}

// Cuántas líneas del principio se usan para adivinar el separador.
const LINEAS_PARA_DETECTAR = 20;

// El separador: se lee el principio del archivo con cada candidato (con el
// mismo csv-parse, así que las comillas se respetan) y gana el que da MÁS de
// una columna y la misma cantidad en más líneas; ante un empate, el primero
// de SEPARADORES, o sea la coma. Sin ningún candidato con más de una columna
// (un CSV de una sola columna), coma.
export function detectarSeparador(texto: string): Separador {
  const muestra = texto.split(/\r?\n/).slice(0, LINEAS_PARA_DETECTAR).join("\n");
  let mejor: { separador: Separador; consistentes: number; columnas: number } | undefined;
  for (const separador of SEPARADORES) {
    let registros: unknown[][];
    try {
      registros = parseCsv(muestra, {
        delimiter: separador,
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as unknown[][];
    } catch {
      continue;
    }
    if (registros.length === 0) continue;
    const columnas = registros[0].length;
    if (columnas < 2) continue;
    const consistentes = registros.filter((r) => r.length === columnas).length;
    if (
      !mejor ||
      consistentes > mejor.consistentes ||
      (consistentes === mejor.consistentes && columnas > mejor.columnas)
    ) {
      mejor = { separador, consistentes, columnas };
    }
  }
  return mejor?.separador ?? ",";
}

function parsearCsv(buffer: Buffer, opciones: OpcionesDeLectura): ArchivoParseado {
  let registros: unknown[][];
  const { texto, codificacion } = decodificarTexto(buffer, opciones.codificacion);
  const separador = opciones.separador ?? detectarSeparador(texto);

  try {
    registros = parseCsv(texto, {
      delimiter: separador,
      // columns: false — se piden ARRAYS, no objetos. Con `columns: true`
      // csv-parse arma el objeto por su cuenta y no deja validar los
      // encabezados repetidos antes de que una columna se coma a la otra.
      columns: false,
      // bom: true no es cosmético: Excel exporta CSV con BOM UTF-8, y sin esto
      // eslint-disable-next-line no-irregular-whitespace -- el ejemplo de la línea siguiente lleva un BOM (U+FEFF) real embebido: es lo que el comentario está mostrando, no un typo. Escaparlo lo explicaría pero no lo exhibiría, y el punto es justamente que el carácter es invisible.
      // el primer encabezado llegaría como "﻿Nombre" y ningún mapeo lo
      // encontraría jamás — con el agravante de que el archivo SE VE bien.
      bom: true,
      skip_empty_lines: true,
      // Una fila con más o menos columnas que el encabezado NO aborta el
      // parseo. En modo estricto csv-parse lanza y se pierde el archivo entero
      // por una fila mal formada, que es exactamente lo que §5 prohíbe: la fila
      // mala se marca y el lote sigue. Acá simplemente entra corta o larga, y
      // la validación por fila decide después.
      relax_column_count: true,
      relax_quotes: true,
    }) as unknown[][];
  } catch (err) {
    throw new AppError(
      `No se pudo leer el CSV: ${err instanceof Error ? err.message : "formato inválido"}`,
      400,
    );
  }

  if (registros.length === 0) {
    throw new AppError("El archivo está vacío", 400);
  }

  const encabezados = validarEncabezados(registros[0]);
  const filas: FilaCruda[] = [];

  for (const registro of registros.slice(1)) {
    if (filas.length >= MAX_FILAS_POR_ARCHIVO) {
      throw new AppError(`El archivo supera el máximo de ${MAX_FILAS_POR_ARCHIVO} filas`, 400);
    }
    const fila = armarFila(encabezados, registro);
    if (!estaVacia(fila)) {
      filas.push(fila);
    }
  }

  return {
    encabezados: encabezados.filter((h) => h !== ""),
    filas,
    lectura: { separador, codificacion },
  };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

// SE USA workbook.xlsx.load(), NO EL LECTOR EN STREAMING, y conviene saber por
// qué porque la elección obvia era la contraria.
//
// La intención original fue el lector en streaming
// (ExcelJS.stream.xlsx.WorkbookReader), porque acota la memoria: las filas
// llegan de a una y el corte por MAX_FILAS_POR_ARCHIVO ocurre antes de
// materializar el resto. NO FUNCIONA, y no por cómo se lo invoque: falla con
// "Cannot read properties of undefined (reading 'sheets')" en
// workbook-reader.js:303, porque llega a _parseWorksheet antes de haber
// parseado xl/workbook.xml y `this.model` todavía es undefined. Se reprodujo
// con un XLSX generado por la propia exceljs y falla igual con
// `worksheets: "ignore"`, así que es la librería, no el uso. Verificado, no
// supuesto.
//
// LO QUE ESO DEJA SIN MITIGAR, dicho explícitamente en vez de omitido: un XLSX
// es un ZIP, así que el tope de IMPORT_MAX_FILE_BYTES acota lo que se SUBE, no
// lo que ocupa al expandirse. `load()` materializa el libro entero, y
// MAX_FILAS_POR_ARCHIVO acota cuántas filas se reenvían, NO cuánta memoria usó
// el parseo. Un archivo deliberadamente construido para expandirse (zip bomb)
// puede hacer bastante más ruido que su tamaño subido — y este es un servidor
// multi-tenant, así que quedarse sin memoria afecta a todas las organizaciones,
// no solo a la que subió el archivo.
//
// Por qué se acepta igual en esta etapa: el que sube es un ADMIN AUTENTICADO de
// la organización, no un anónimo. La superficie es una cuenta con sesión, no
// internet entero — al revés que el webhook del ítem 4. Queda anotado como
// endurecimiento pendiente, no como algo que se pasó por alto.
async function parsearXlsx(buffer: Buffer, opciones: OpcionesDeLectura): Promise<ArchivoParseado> {
  // Antes de entregarle el archivo a exceljs, que lo descomprime entero en
  // memoria: ver revisarZip.
  revisarZip(buffer);

  const workbook = new ExcelJS.Workbook();

  // exceljs declara `load(buffer: Buffer)` contra un @types/node anterior al
  // Buffer genérico (`Buffer<ArrayBufferLike>`), así que TypeScript los ve como
  // tipos incompatibles aunque en runtime sean exactamente el mismo objeto. El
  // cast expresa esa diferencia de TIPADOS entre paquetes, no una conversión de
  // datos: no hay ninguna transformación ocurriendo acá.
  //
  // SE CASTEA EL OBJETO Y SE LLAMA EL MÉTODO SOBRE ÉL, en vez de extraer `load`
  // a una variable: extraerlo pierde el receptor y adentro de exceljs `this`
  // queda undefined, que se manifiesta como un "Cannot read properties of
  // undefined (reading 'parseRels')" que no se parece en nada a su causa.
  const xlsx = workbook.xlsx as unknown as { load(b: unknown): Promise<unknown> };

  try {
    await xlsx.load(buffer);
  } catch (err) {
    throw new AppError(
      `No se pudo leer el archivo Excel: ${err instanceof Error ? err.message : "formato inválido"}`,
      400,
    );
  }

  // UNA SOLA HOJA. Un libro con varias hojas casi nunca tiene el mismo
  // conjunto de columnas en todas, así que concatenarlas produciría filas con
  // los encabezados de otra hoja. Sin opciones.hoja, la primera (lo de
  // siempre); el asistente deja elegir otra por nombre.
  const hojas = workbook.worksheets.map((w) => w.name);
  const worksheet =
    opciones.hoja === undefined
      ? workbook.worksheets[0]
      : workbook.worksheets.find((w) => w.name === opciones.hoja);
  if (!worksheet) {
    throw new AppError(
      opciones.hoja === undefined
        ? "El archivo no tiene ninguna hoja"
        : `El archivo no tiene una hoja «${opciones.hoja}». Hojas: ${hojas.join(", ")}`,
      400,
    );
  }

  let encabezados: string[] | undefined;
  const filas: FilaCruda[] = [];
  let excedido = false;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (excedido) return;

    // row.values de exceljs es 1-based: la posición 0 siempre viene vacía.
    const celdas = (row.values as unknown[]).slice(1);

    if (encabezados === undefined) {
      encabezados = validarEncabezados(celdas);
      return;
    }

    if (filas.length >= MAX_FILAS_POR_ARCHIVO) {
      excedido = true;
      return;
    }

    const fila = armarFila(encabezados, celdas);
    if (!estaVacia(fila)) {
      filas.push(fila);
    }
  });

  // Fuera del callback: eachRow es sincrónico, y lanzar adentro funcionaría,
  // pero dejar la condición explícita acá hace evidente que se RECHAZA y no se
  // trunca — truncar en silencio es el modo de falla peligroso.
  if (excedido) {
    throw new AppError(`El archivo supera el máximo de ${MAX_FILAS_POR_ARCHIVO} filas`, 400);
  }

  if (encabezados === undefined) {
    throw new AppError("El archivo está vacío", 400);
  }

  return {
    encabezados: encabezados.filter((h) => h !== ""),
    filas,
    lectura: { hojas, hoja: worksheet.name },
  };
}

// ---------------------------------------------------------------------------
// ZIP BOMB (docs/importacion-de-datos.md §9.2). exceljs descomprime el libro
// entero en memoria (el lector en streaming está roto, ver arriba), así que
// el tope de 10 MB acota lo que se SUBE y no lo que ocupa al expandirse. Esto
// lee el directorio central del ZIP —la lista de entradas que está al final
// del archivo, con el tamaño descomprimido declarado de cada una— y rechaza
// el archivo antes de descomprimir nada si la suma, la cantidad de entradas o
// la proporción de compresión pasan los topes.
//
// RIESGO QUE QUEDA, dicho explícitamente: los tamaños son los DECLARADOS. Un
// ZIP armado a mano puede declarar poco y descomprimir mucho, y esto no lo
// ve. Acota el caso común (un ZIP bomb de manual declara sus tamaños reales)
// y el resto lo acotan el tope de 10 MB y quién puede subir. No es una
// garantía. ZIP64 se rechaza: un XLSX de 10 MB nunca lo necesita.
// ---------------------------------------------------------------------------

export const MAX_BYTES_DESCOMPRIMIDOS = 100 * 1024 * 1024;
export const MAX_ENTRADAS_DEL_ZIP = 5_000;
// Una hoja de cálculo comprime bien (XML repetitivo), del orden de 10 a 1.
// 200 a 1 en una entrada grande ya no es una planilla.
export const MAX_PROPORCION_DE_COMPRESION = 200;
const ENTRADA_GRANDE = 1024 * 1024;

const FIRMA_FIN_DE_DIRECTORIO = 0x06054b50;
const FIRMA_ENTRADA_DEL_DIRECTORIO = 0x02014b50;

function zipInvalido(detalle: string): AppError {
  return new AppError(`No se pudo leer el archivo Excel: ${detalle}`, 400);
}

export function revisarZip(buffer: Buffer): void {
  // El registro de fin de directorio mide 22 bytes más un comentario de hasta
  // 65.535: se busca la firma desde el final hacia atrás.
  const desde = Math.max(0, buffer.length - 22 - 0xffff);
  let fin = -1;
  for (let i = buffer.length - 22; i >= desde; i--) {
    if (buffer.readUInt32LE(i) === FIRMA_FIN_DE_DIRECTORIO) {
      fin = i;
      break;
    }
  }
  if (fin < 0) {
    throw zipInvalido("no es un archivo .xlsx válido");
  }
  const entradas = buffer.readUInt16LE(fin + 10);
  const tamanoDelDirectorio = buffer.readUInt32LE(fin + 12);
  const inicio = buffer.readUInt32LE(fin + 16);
  if (entradas === 0xffff || inicio === 0xffffffff || tamanoDelDirectorio === 0xffffffff) {
    throw zipInvalido("el archivo usa un formato ZIP que no se acepta (ZIP64)");
  }
  if (entradas > MAX_ENTRADAS_DEL_ZIP) {
    throw zipInvalido(`tiene ${entradas} archivos internos (máximo ${MAX_ENTRADAS_DEL_ZIP})`);
  }
  if (inicio + tamanoDelDirectorio > fin) {
    throw zipInvalido("el índice interno está dañado");
  }

  let total = 0;
  let p = inicio;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > fin || buffer.readUInt32LE(p) !== FIRMA_ENTRADA_DEL_DIRECTORIO) {
      throw zipInvalido("el índice interno está dañado");
    }
    const comprimido = buffer.readUInt32LE(p + 20);
    const descomprimido = buffer.readUInt32LE(p + 24);
    if (comprimido === 0xffffffff || descomprimido === 0xffffffff) {
      throw zipInvalido("el archivo usa un formato ZIP que no se acepta (ZIP64)");
    }
    if (
      descomprimido > ENTRADA_GRANDE &&
      descomprimido > Math.max(comprimido, 1) * MAX_PROPORCION_DE_COMPRESION
    ) {
      throw zipInvalido("su contenido se expande demasiado al descomprimirlo");
    }
    total += descomprimido;
    if (total > MAX_BYTES_DESCOMPRIMIDOS) {
      throw zipInvalido(
        `descomprimido ocuparía más de ${MAX_BYTES_DESCOMPRIMIDOS / (1024 * 1024)} MB`,
      );
    }
    p +=
      46 + buffer.readUInt16LE(p + 28) + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
}

// ---------------------------------------------------------------------------

export type FormatoDeArchivo = "csv" | "xlsx";

// El formato se decide por la EXTENSIÓN del nombre original, no por el
// Content-Type que declare el cliente: en un multipart ese header lo elige
// quien sube, y los navegadores mandan cualquier cosa para un .csv
// (application/vnd.ms-excel es habitual). La extensión es igual de manipulable,
// pero al menos es lo que el usuario ve.
//
// Si el contenido no coincide con la extensión, el parser falla con un 400
// explícito — el formato real lo decide el parseo, no esta función.
// XLS (Excel 97-2003) y ODS no se leen (decisión 2 de
// docs/importacion-de-datos.md: exceljs no los soporta y la alternativa sumaba
// riesgo). Tienen su propio mensaje, que dice qué hacer, en vez del genérico.
export const MENSAJE_GUARDAR_COMO_XLSX = "Guardalo como .xlsx o .csv y volvé a subirlo";

export function formatoDesdeNombre(nombre: string): FormatoDeArchivo {
  const minuscula = nombre.toLowerCase();
  if (minuscula.endsWith(".csv")) return "csv";
  if (minuscula.endsWith(".xlsx")) return "xlsx";
  if (minuscula.endsWith(".xls") || minuscula.endsWith(".ods")) {
    throw new AppError(
      `Los archivos ${minuscula.endsWith(".xls") ? ".xls" : ".ods"} no se pueden leer. ${MENSAJE_GUARDAR_COMO_XLSX}`,
      415,
    );
  }

  throw new AppError("Formato no soportado: solo se aceptan archivos .csv y .xlsx", 415);
}

export async function parsearArchivo(
  buffer: Buffer,
  formato: FormatoDeArchivo,
  opciones: OpcionesDeLectura = {},
): Promise<ArchivoParseado> {
  const parseado =
    formato === "csv" ? parsearCsv(buffer, opciones) : await parsearXlsx(buffer, opciones);

  if (parseado.filas.length === 0) {
    throw new AppError("El archivo no tiene ninguna fila de datos", 400);
  }

  if (opciones.limites) {
    aplicarLimites(parseado, opciones.limites);
  }

  return parseado;
}

// Los topes del asistente (§9.2). Un archivo que los pasa se rechaza entero,
// con la fila y la columna: es un archivo hostil o roto, no una fila con un
// dato malo, y lo que guarda el staging tiene que caber. Se cuenta como en
// filasParaStaging: fila 1 = la primera de datos.
function aplicarLimites(parseado: ArchivoParseado, limites: LimitesDeLectura): void {
  if (parseado.encabezados.length > limites.maxColumnas) {
    throw new AppError(
      `El archivo tiene ${parseado.encabezados.length} columnas (máximo ${limites.maxColumnas})`,
      400,
    );
  }
  parseado.filas.forEach((fila, i) => {
    for (const [columna, valor] of Object.entries(fila)) {
      if (typeof valor === "string" && valor.length > limites.maxCaracteresPorCelda) {
        throw new AppError(
          `La fila ${i + 1}, columna «${columna}», tiene ${valor.length} caracteres (máximo ${limites.maxCaracteresPorCelda})`,
          400,
        );
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(fila), "utf8");
    if (bytes > limites.maxBytesPorFila) {
      throw new AppError(
        `La fila ${i + 1} ocupa ${Math.ceil(bytes / 1024)} KB (máximo ${limites.maxBytesPorFila / 1024} KB)`,
        400,
      );
    }
  });
}

// EL externalId DE UNA FILA DE ARCHIVO INCLUYE SU NÚMERO DE FILA, y la decisión
// tiene consecuencias en los dos sentidos:
//
//   - A FAVOR: un archivo puede tener dos filas de contenido idéntico y son dos
//     leads distintos. Con un hash solo del contenido colapsarían en un evento
//     y se perdería uno, en silencio. El número de fila las distingue.
//   - EN CONTRA: si alguien inserta una fila al PRINCIPIO y vuelve a subir, se
//     corren todos los números y el archivo entero se reingesta. El costo de
//     eso está acotado y es benigno: la promoción hace upsert por email, así
//     que reingerir actualiza contactos existentes en vez de duplicarlos —
//     cuesta filas de staging y trabajo del worker, nunca datos corruptos.
//
// El caso que §4 exige —"un Excel que se sube dos veces" no duplica— se cumple
// exacto: el mismo archivo tiene las mismas filas en las mismas posiciones, así
// que produce los mismos externalId y el ON CONFLICT los descarta.
//
// Reusa deriveExternalId (JSON canónico + SHA-256) sin agregar una segunda
// forma de hashear: el objeto que se hashea es { fila, datos }.
export function filasParaStaging(filas: FilaCruda[]): FilaParaStaging[] {
  return filas.map((fila, i) => ({
    // 1-based y contando solo filas de datos: es el número que ve quien mira el
    // archivo en Excel menos la fila de encabezados.
    externalId: deriveExternalId({ fila: i + 1, datos: fila }),
    rawPayload: fila,
  }));
}

// ---------------------------------------------------------------------------
// CELDAS QUE EMPIEZAN CON =, +, - O @ (inyección de fórmulas; FABLE-I-06 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// ESTADO AL 05/10/2026: ESTE BACKEND NO EXPORTA NADA A CSV NI A EXCEL. Este
// archivo solo LEE planillas (la importación), y el frontend no arma
// descargas. Por eso lo que se importa se guarda tal cual: una celda
// `=HYPERLINK(...)` queda como ese texto en el campo del contacto, y como
// texto es inofensiva — la pantalla la muestra, no la evalúa. Cambiar el dato
// al importarlo sería corromper lo que la persona cargó (un teléfono
// "+598 99…" o un cargo "-Gerente" son legítimos).
//
// EL RIESGO APARECE EL DÍA QUE HAYA UNA EXPORTACIÓN: Excel, LibreOffice y
// Google Sheets evalúan como fórmula cualquier celda que empiece con uno de
// esos caracteres, así que un valor que entró por una importación, un webhook
// o el chat se ejecutaría en la máquina de quien abra el archivo.
//
// QUIEN ESCRIBA ESA EXPORTACIÓN TIENE QUE PASAR CADA CELDA DE TEXTO POR ESTA
// FUNCIÓN. Antepone un apóstrofo, que las planillas leen como "esto es texto"
// y no muestran. También cubre el tab y el retorno de carro iniciales, que
// algunas planillas saltean antes de mirar el primer carácter. Los números y
// los valores vacíos no se tocan.
// ---------------------------------------------------------------------------
const EMPIEZA_COMO_FORMULA = /^[=+\-@\t\r]/;

export function neutralizarCeldaParaExportar<T>(valor: T): T | string {
  if (typeof valor !== "string" || !EMPIEZA_COMO_FORMULA.test(valor)) {
    return valor;
  }
  return `'${valor}`;
}
