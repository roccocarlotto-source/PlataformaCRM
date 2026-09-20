import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { ConversationDetail, ConversationListQuery, ConversationListResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/knowledgeBase/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
//
// LO QUE SIGUE SIN ESTAR, y es lo que el ítem 66 dejó dicho: no hay crear, no
// hay cerrar y sobre todo NO HAY RESPONDER — no porque falte escribirlo acá,
// sino porque no existe del lado del backend y no puede existir hasta que haya
// forma de ENTREGAR un mensaje saliente por el canal (ver el comentario de
// src/services/conversation.service.ts).
//
// LAS DOS ESCRITURAS QUE SÍ ESTÁN son las del brief (ítem 73), y no abren esa
// puerta: el brief es una anotación interna sobre la conversación, no un
// mensaje. Nunca sale por ningún canal ni lo ve el contacto.
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

// ---------------------------------------------------------------------------
// El brief (ítem 73). Las dos devuelven la conversación ENTERA con su hilo —la
// misma forma que el GET del detalle— y no solo el brief, así que la mutation
// puede escribir la respuesta directo en la cache del detalle.
// ---------------------------------------------------------------------------

// `null` vacía el resumen. Es un PATCH con un solo campo y ese campo es
// obligatorio en el body: un PATCH vacío no significaría nada en un recurso
// con una sola cosa editable, y el backend lo rechaza.
export function updateConversationBrief(
  id: string,
  brief: string | null,
): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/conversations/${id}`, {
    method: "PATCH",
    body: { brief },
    getAccessToken,
  });
}

// Sin body: no hay nada que elegir, el transcript sale de la conversación y el
// prompt es fijo del lado del servidor. Tarda lo que tarda el modelo, así que
// la pantalla muestra el botón en curso mientras corre.
export function generateConversationBrief(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/conversations/${id}/generate-brief`, {
    method: "POST",
    getAccessToken,
  });
}
