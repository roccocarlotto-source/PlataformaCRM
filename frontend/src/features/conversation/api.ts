import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { ConversationDetail, ConversationListQuery, ConversationListResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/knowledgeBase/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
//
// DOS FUNCIONES Y NINGUNA MUTACIÓN, y es el ítem entero: la bandeja lee. No
// hay crear, editar, cerrar ni responder — no porque falte escribirlo acá,
// sino porque no existen del lado del backend y no pueden existir hasta que
// haya forma de ENTREGAR un mensaje saliente por el canal (ver el comentario
// de src/services/conversation.service.ts). Por eso tampoco hay mutations.ts
// en esta feature.
function buildListQueryString(query: ConversationListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.agentId) params.set("agentId", query.agentId);
  if (query.contactId) params.set("contactId", query.contactId);
  if (query.status) params.set("status", query.status);
  if (query.channel) params.set("channel", query.channel);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listConversations(
  query: ConversationListQuery,
  signal?: AbortSignal,
): Promise<ConversationListResponse> {
  return request<ConversationListResponse>(`/conversations${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// Trae la conversación CON todos sus mensajes: una sola request para la
// pantalla entera, no una por el hilo.
export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/conversations/${id}`, { getAccessToken, signal });
}
