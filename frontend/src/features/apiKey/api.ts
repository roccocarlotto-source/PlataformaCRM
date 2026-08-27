import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  ApiKey,
  ApiKeyListQuery,
  ApiKeyListResponse,
  CreateApiKeyInput,
  CreatedApiKey,
} from "./types";

function buildListQueryString(query: ApiKeyListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.sourceId) params.set("sourceId", query.sourceId);
  if (query.status) params.set("status", query.status);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listApiKeys(
  query: ApiKeyListQuery,
  signal?: AbortSignal,
): Promise<ApiKeyListResponse> {
  return request<ApiKeyListResponse>(`/api-keys${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// La ÚNICA función de este módulo que devuelve CreatedApiKey (con `key`). El
// tipo de retorno es lo que hace que el secreto no pueda leerse desde ninguna
// otra respuesta por accidente.
export function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("/api-keys", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

// DELETE que devuelve 200 CON BODY (la clave ya revocada), no 204 — desviación
// deliberada del backend respecto del resto de sus DELETE, documentada en
// apiKey.controller.ts. Y NO es idempotente: la segunda llamada da 409.
export function revokeApiKey(id: string): Promise<ApiKey> {
  return request<ApiKey>(`/api-keys/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
