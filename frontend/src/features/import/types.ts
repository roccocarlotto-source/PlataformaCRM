// Reconstruido desde el contrato real del backend (src/services/import.service.ts,
// src/controllers/import.controller.ts, src/repositories/ingestionEvent.repository.ts).
// No se agrega ningún campo que el backend no devuelva o no acepte.

// Respuesta 202 de POST /api/imports — ResultadoImportacion en import.service.ts.
export interface ImportResult {
  batchId: string;
  // Columnas detectadas en el archivo. Sirven para diagnosticar un mapeo que no
  // matchea: sin ellas, un ADMIN cuyas filas fallaron todas por una tilde en un
  // encabezado no tiene forma de verlo.
  encabezados: string[];
  filasLeidas: number;
  insertados: number;
  // Filas cuyo (sourceId, externalId) ya existía: el archivo, o parte de él, ya
  // se había subido antes. NO quedan asociadas a este lote — pertenecen al que
  // las trajo — así que este número SOLO se ve acá, en la respuesta de la
  // subida. El GET del lote de una re-subida da 404, no un resumen en cero
  // (§9.9 de docs/ingestion-architecture.md).
  duplicados: number;
}

// Respuesta 200 de POST /api/imports/preview — ResultadoPrevisualizacion.
// Mismo campo `encabezados` que ImportResult, a propósito: es la misma cosa
// venga del camino que venga.
export interface ImportPreview {
  encabezados: string[];
}

// FallaDeLote en ingestionEvent.repository.ts.
export interface FallaDeLote {
  id: string;
  errorMessage: string | null;
  // La fila del archivo tal como se guardó, con sus encabezados originales.
  rawPayload: unknown;
}

// ResumenDeLote en ingestionEvent.repository.ts — la respuesta de
// GET /api/imports/:batchId.
//
// No hay campo de duplicados acá: ver el comentario de ImportResult.duplicados.
export interface ImportBatchSummary {
  batchId: string;
  total: number;
  pendientes: number;
  promovidos: number;
  fallidos: number;
  // Topeada en 100 del lado del backend (MAX_FALLAS_DEVUELTAS).
  fallas: FallaDeLote[];
  // Cuántas fallas quedaron afuera de la muestra. El backend nunca trunca en
  // silencio, y la UI tampoco debe.
  fallasOmitidas: number;
}

// Topes reales del backend, replicados para poder avisar ANTES del round-trip
// — mismo criterio que MAX_COLUMNAS_MAPEADAS en source/types.ts. No reemplazan
// la validación server-side: multer sigue siendo quien decide de verdad.
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EXTENSIONES_SOPORTADAS = [".csv", ".xlsx"] as const;
