import { request, uploadFile } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateKnowledgeBaseEntryInput,
  KnowledgeBaseEntry,
  KnowledgeBaseExtractedText,
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

// POST /api/knowledge-base/extract-text — ítem 60. Va por uploadFile
// (multipart) y no por request(), que siempre serializa a JSON: un FormData
// por ese camino llegaría al backend como "[object Object]". Mismo uso que
// previewImport en features/import/api.ts.
//
// NO CREA NI MODIFICA NINGUNA ENTRADA y no guarda el archivo: devuelve el
// texto y ahí termina. Por eso no invalida ninguna query y vive en api.ts sin
// una mutation de react-query alrededor — no hay cache que tocar.
export function extractKnowledgeBaseText(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<KnowledgeBaseExtractedText> {
  const form = new FormData();
  form.append("file", file);

  return uploadFile<KnowledgeBaseExtractedText>("/knowledge-base/extract-text", form, {
    getAccessToken,
    ...options,
  });
}
