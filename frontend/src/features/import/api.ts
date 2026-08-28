import { request, uploadFile } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { ImportBatchSummary, ImportPreview, ImportResult } from "./types";

// Los dos POST van por uploadFile (multipart); el GET por request() de siempre,
// porque es JSON común.

// POST /api/imports — la importación REAL. Crea IngestionEvent en staging.
//
// `sourceId` viaja como campo de TEXTO del multipart, no en el path: la ruta es
// plana (/api/imports) y en un formulario un campo más no cuesta nada. Multer
// deja los campos de texto en req.body una vez procesado el cuerpo entero, así
// que el orden en el que se agreguen acá no importa.
export function importFile(
  sourceId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<ImportResult> {
  const form = new FormData();
  form.append("sourceId", sourceId);
  form.append("file", file);

  return uploadFile<ImportResult>("/imports", form, { getAccessToken, ...options });
}

// POST /api/imports/preview — SOLO lee los encabezados. No crea nada, y por eso
// no lleva sourceId: la pregunta "¿qué columnas tiene este archivo?" no depende
// de ninguna fuente.
//
// Vive en este slice y lo consume también features/source/ (la sugerencia de
// mapeo): es la misma llamada al mismo endpoint, no hay razón para tener dos.
export function previewImport(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);

  return uploadFile<ImportPreview>("/imports/preview", form, { getAccessToken, ...options });
}

// GET /api/imports/:batchId — el estado del lote. Los contadores se derivan de
// un GROUP BY server-side, así que cada llamada trae el estado del momento: los
// eventos se promueven de forma asíncrona (worker), no al terminar la subida.
export function getImportBatch(batchId: string, signal?: AbortSignal): Promise<ImportBatchSummary> {
  return request<ImportBatchSummary>(`/imports/${batchId}`, { getAccessToken, signal });
}
