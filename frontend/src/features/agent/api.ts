import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Agent,
  AgentListQuery,
  AgentListResponse,
  CreateAgentInput,
  UpdateAgentInput,
} from "./types";

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
