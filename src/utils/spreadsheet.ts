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
}

// Una fila lista para escribirse en staging.
export interface FilaParaStaging {
  externalId: string;
  rawPayload: FilaCruda;
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
    // docs/auditoria-2026-08-29.md). Se guarda el código de error tal cual: es
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
    fila[encabezado] = normalizarCelda(celdas[i]);
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

function parsearCsv(buffer: Buffer): ArchivoParseado {
  let registros: unknown[][];

  try {
    registros = parseCsv(buffer, {
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

  return { encabezados: encabezados.filter((h) => h !== ""), filas };
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
async function parsearXlsx(buffer: Buffer): Promise<ArchivoParseado> {
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

  // SOLO LA PRIMERA HOJA. Un libro con varias hojas casi nunca tiene el mismo
  // conjunto de columnas en todas, así que concatenarlas produciría filas con
  // los encabezados de otra hoja. Límite conocido: para importar otra hoja, se
  // exporta esa hoja.
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new AppError("El archivo no tiene ninguna hoja", 400);
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

  return { encabezados: encabezados.filter((h) => h !== ""), filas };
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
export function formatoDesdeNombre(nombre: string): FormatoDeArchivo {
  const minuscula = nombre.toLowerCase();
  if (minuscula.endsWith(".csv")) return "csv";
  if (minuscula.endsWith(".xlsx")) return "xlsx";

  throw new AppError("Formato no soportado: solo se aceptan archivos .csv y .xlsx", 415);
}

export async function parsearArchivo(
  buffer: Buffer,
  formato: FormatoDeArchivo,
): Promise<ArchivoParseado> {
  const parseado = formato === "csv" ? parsearCsv(buffer) : await parsearXlsx(buffer);

  if (parseado.filas.length === 0) {
    throw new AppError("El archivo no tiene ninguna fila de datos", 400);
  }

  return parseado;
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
