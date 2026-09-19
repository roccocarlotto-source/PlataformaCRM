import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Agent,
  AgentListQuery,
  AgentListResponse,
  CreateAgentInput,
  GuardrailsTranslation,
  UpdateAgentInput,
} from "./types";
import type { CreatedEmbedToken, EmbedToken, EmbedTokenListResponse } from "./embedToken.types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/branch/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
function buildListQueryString(query: AgentListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branchId", query.branchId);
  // Booleano explícito: `if (query.isActive)` se comería el filtro "inactivos".
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listAgents(
  query: AgentListQuery,
  signal?: AbortSignal,
): Promise<AgentListResponse> {
  return request<AgentListResponse>(`/agents${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getAgent(id: string, signal?: AbortSignal): Promise<Agent> {
  return request<Agent>(`/agents/${id}`, { getAccessToken, signal });
}

export function createAgent(input: CreateAgentInput): Promise<Agent> {
  return request<Agent>("/agents", { method: "POST", body: input, getAccessToken });
}

export function updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
  return request<Agent>(`/agents/${id}`, { method: "PATCH", body: input, getAccessToken });
}

// 204 sin body — request() devuelve undefined en ese caso. Es soft delete, y
// del lado del backend revoca en cascada los tokens de embed del agente
// (agent.service.ts); acá no hay nada que hacer con eso, es transparente.
export function deleteAgent(id: string): Promise<void> {
  return request<void>(`/agents/${id}`, { method: "DELETE", getAccessToken });
}

// Traductor de guardrails en lenguaje natural (ítem 56). NO guarda nada: el
// formulario lo llama al hacer submit, muestra lo que se entendió, y recién
// con la confirmación del ADMIN manda el POST/PATCH real llevando el mismo
// objeto que devolvió acá. Por eso NO hay `signal`: no es una lectura de
// pantalla que se cancele al desmontar, es un paso del guardado.
export function translateGuardrails(text: string): Promise<GuardrailsTranslation> {
  return request<GuardrailsTranslation>("/agents/guardrails/translate", {
    method: "POST",
    body: { text },
    getAccessToken,
  });
}

// ---------------------------------------------------------------------------
// Tokens de embed del widget (ítem 63). Ruta ANIDADA bajo el agente
// (/agents/:id/embed-tokens), no plana con ?agentId=: un token de embed no
// tiene existencia propia fuera de su agente — ver el comentario de
// src/routes/agentEmbedToken.routes.ts. Las tres son ADMIN-only en el
// backend, la LECTURA incluida.
// ---------------------------------------------------------------------------

// Metadata sin el token: tokenPrefix + fechas. El token en claro no está acá
// ni puede estarlo — el backend solo guarda su hash.
export function listEmbedTokens(
  agentId: string,
  signal?: AbortSignal,
): Promise<EmbedTokenListResponse> {
  return request<EmbedTokenListResponse>(`/agents/${agentId}/embed-tokens`, {
    getAccessToken,
    signal,
  });
}

// LA ÚNICA LLAMADA DEL SISTEMA QUE DEVUELVE UN TOKEN EN CLARO, en `token`, y
// una sola vez: no se persiste en ningún lado, así que lo que el llamador no
// muestre en esta respuesta se perdió. Sin body: un token no tiene más
// configuración que el agente del que cuelga.
export function createEmbedToken(agentId: string): Promise<CreatedEmbedToken> {
  return request<CreatedEmbedToken>(`/agents/${agentId}/embed-tokens`, {
    method: "POST",
    getAccessToken,
  });
}

// NO es idempotente: revocar un token ya revocado da 409 con un mensaje
// legible ("Este token ya fue revocado"), igual que DELETE /api-keys/:id.
// Devuelve el token actualizado, no 204.
export function revokeEmbedToken(agentId: string, tokenId: string): Promise<EmbedToken> {
  return request<EmbedToken>(`/agents/${agentId}/embed-tokens/${tokenId}`, {
    method: "DELETE",
    getAccessToken,
  });
}
