import { neutralizarCeldaParaExportar, type ValorDeCelda } from "./spreadsheet";

// ---------------------------------------------------------------------------
// LA PRIMERA EXPORTACIÓN DEL BACKEND: los CSV del informe del asistente de
// importación (docs/importacion-de-datos.md §8.1 y §9.4), con las filas
// fallidas para corregir y volver a subir, y con los cambios hechos.
//
//   - Separador ";" y UTF-8 con BOM (decisión 18): es lo que Excel en español
//     abre bien con doble clic. Con "," y sin BOM, Excel en una PC en español
//     muestra todo en una columna y las tildes rotas.
//   - CADA CELDA pasa por neutralizarCeldaParaExportar, sin excepción: lo que
//     sale acá vino de un archivo de un cliente, y una celda "=HYPERLINK(...)"
//     se ejecutaría en la máquina de quien abra el CSV (FABLE-I-06 de
//     docs-privados/auditoria-2026-10-05-FABLE.md, local). También los textos
//     que arma el backend ("Motivo"), porque pueden citar un valor del archivo.
//   - Comillas dobles alrededor de toda celda con ";", comillas o saltos de
//     línea, duplicando las comillas internas (RFC 4180).
// ---------------------------------------------------------------------------

const BOM = "﻿";
const SEPARADOR = ";";

function celdaCsv(valor: ValorDeCelda): string {
  if (valor === null) return "";
  const neutralizada = neutralizarCeldaParaExportar(valor);
  const texto = String(neutralizada);
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function armarCsv(encabezados: readonly string[], filas: readonly ValorDeCelda[][]): Buffer {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(celdaCsv).join(SEPARADOR));
  return Buffer.from(`${BOM}${lineas.join("\r\n")}\r\n`, "utf8");
}
