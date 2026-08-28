import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { IngestionEvent, IngestionEventListQuery, IngestionEventListResponse } from "./types";

function buildListQueryString(query: IngestionEventListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.sourceId) params.set("sourceId", query.sourceId);
  if (query.status) params.set("status", query.status);
  if (query.batchId) params.set("batchId", query.batchId);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  // sortBy no se manda: el backend solo acepta "createdAt" y ya lo aplica por
  // default. Ver el comentario de IngestionEventListQuery.
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listIngestionEvents(
  query: IngestionEventListQuery,
  signal?: AbortSignal,
): Promise<IngestionEventListResponse> {
  return request<IngestionEventListResponse>(`/ingestion-events${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// POST y no PATCH: no se edita un recurso, se pide que se vuelva a ejecutar un
// proceso sobre él. Devuelve 200 con el evento ya en PENDING.
//
// NO PROMUEVE: el evento queda encolado y lo toma el worker en su próxima
// pasada. Un 200 acá significa "reencolado", nunca "procesado".
//
// No es idempotente: un segundo POST sobre el mismo evento da 409, porque ya no
// está en FAILED.
export function retryIngestionEvent(id: string): Promise<IngestionEvent> {
  return request<IngestionEvent>(`/ingestion-events/${id}/retry`, {
    method: "POST",
    getAccessToken,
  });
}
