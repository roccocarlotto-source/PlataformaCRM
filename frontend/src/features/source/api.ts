import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateSourceInput,
  Source,
  SourceListQuery,
  SourceListResponse,
  UpdateSourceInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente propio, sin
// persistencia manual de tokens. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
function buildListQueryString(query: SourceListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.type) params.set("type", query.type);
  // isActive se serializa explícitamente porque es un booleano y `false` es un
  // valor válido, no "sin filtro": un `if (query.isActive)` se comería el filtro
  // de "pausadas", que es justamente el más útil de los dos.
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listSources(
  query: SourceListQuery,
  signal?: AbortSignal,
): Promise<SourceListResponse> {
  return request<SourceListResponse>(`/sources${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getSource(id: string, signal?: AbortSignal): Promise<Source> {
  return request<Source>(`/sources/${id}`, { getAccessToken, signal });
}

export function createSource(input: CreateSourceInput): Promise<Source> {
  return request<Source>("/sources", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateSource(id: string, input: UpdateSourceInput): Promise<Source> {
  return request<Source>(`/sources/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body — request() devuelve undefined en ese caso.
export function deleteSource(id: string): Promise<void> {
  return request<void>(`/sources/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
