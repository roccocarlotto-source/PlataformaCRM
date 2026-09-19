import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateKnowledgeBaseEntryInput,
  KnowledgeBaseEntry,
  KnowledgeBaseListQuery,
  KnowledgeBaseListResponse,
  UpdateKnowledgeBaseEntryInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/agent/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
function buildListQueryString(query: KnowledgeBaseListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branchId", query.branchId);
  // Booleano explícito: `if (query.isActive)` se comería el filtro "inactivas".
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listKnowledgeBaseEntries(
  query: KnowledgeBaseListQuery,
  signal?: AbortSignal,
): Promise<KnowledgeBaseListResponse> {
  return request<KnowledgeBaseListResponse>(`/knowledge-base${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getKnowledgeBaseEntry(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeBaseEntry> {
  return request<KnowledgeBaseEntry>(`/knowledge-base/${id}`, { getAccessToken, signal });
}

export function createKnowledgeBaseEntry(
  input: CreateKnowledgeBaseEntryInput,
): Promise<KnowledgeBaseEntry> {
  return request<KnowledgeBaseEntry>("/knowledge-base", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateKnowledgeBaseEntry(
  id: string,
  input: UpdateKnowledgeBaseEntryInput,
): Promise<KnowledgeBaseEntry> {
  return request<KnowledgeBaseEntry>(`/knowledge-base/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body — request() devuelve undefined en ese caso. Es soft delete, sin
// ninguna cascada: nada cuelga de una entrada de la base de conocimiento.
export function deleteKnowledgeBaseEntry(id: string): Promise<void> {
  return request<void>(`/knowledge-base/${id}`, { method: "DELETE", getAccessToken });
}
