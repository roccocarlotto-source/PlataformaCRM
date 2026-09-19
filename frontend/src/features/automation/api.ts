import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Automation,
  AutomationListQuery,
  AutomationListResponse,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/knowledgeBase/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
function buildListQueryString(query: AutomationListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.triggerType) params.set("triggerType", query.triggerType);
  // Booleano explícito: `if (query.isActive)` se comería el filtro "inactivas".
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listAutomations(
  query: AutomationListQuery,
  signal?: AbortSignal,
): Promise<AutomationListResponse> {
  return request<AutomationListResponse>(`/automations${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getAutomation(id: string, signal?: AbortSignal): Promise<Automation> {
  return request<Automation>(`/automations/${id}`, { getAccessToken, signal });
}

export function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  return request<Automation>("/automations", { method: "POST", body: input, getAccessToken });
}

export function updateAutomation(id: string, input: UpdateAutomationInput): Promise<Automation> {
  return request<Automation>(`/automations/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body — request() devuelve undefined en ese caso. Es soft delete: las
// AutomationExecution de la regla se conservan como historial y la regla deja
// de despacharse de inmediato.
export function deleteAutomation(id: string): Promise<void> {
  return request<void>(`/automations/${id}`, { method: "DELETE", getAccessToken });
}
