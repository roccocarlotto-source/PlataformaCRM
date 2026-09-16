import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityDashboardSummary,
  OpportunityListQuery,
  OpportunityListResponse,
  OpportunityRevenueGranularity,
  OpportunityRevenueSeries,
  UpdateOpportunityInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente propio.
// organizationId nunca viaja acá: se resuelve exclusivamente server-side
// desde el JWT.
function buildListQueryString(query: OpportunityListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.companyId) params.set("companyId", query.companyId);
  if (query.contactId) params.set("contactId", query.contactId);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (query.pipelineId) params.set("pipelineId", query.pipelineId);
  if (query.stageId) params.set("stageId", query.stageId);
  if (query.status) params.set("status", query.status);
  if (query.currency) params.set("currency", query.currency);
  if (query.minAmount !== undefined) params.set("minAmount", String(query.minAmount));
  if (query.maxAmount !== undefined) params.set("maxAmount", String(query.maxAmount));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listOpportunities(
  query: OpportunityListQuery,
  signal?: AbortSignal,
): Promise<OpportunityListResponse> {
  return request<OpportunityListResponse>(`/opportunities${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getOpportunity(id: string, signal?: AbortSignal): Promise<Opportunity> {
  return request<Opportunity>(`/opportunities/${id}`, { getAccessToken, signal });
}

export function createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
  return request<Opportunity>("/opportunities", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateOpportunity(id: string, input: UpdateOpportunityInput): Promise<Opportunity> {
  return request<Opportunity>(`/opportunities/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteOpportunity(id: string): Promise<void> {
  return request<void>(`/opportunities/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}

// Resumen comercial del Dashboard (§30). Desde el §35 lleva la granularidad
// del selector de período, igual que la serie de ingresos: los bordes de cada
// ventana los sigue fijando el backend con su propio reloj (en UTC).
export function getOpportunityDashboardSummary(
  granularity: OpportunityRevenueGranularity,
  signal?: AbortSignal,
): Promise<OpportunityDashboardSummary> {
  return request<OpportunityDashboardSummary>(
    `/opportunities/dashboard-summary?granularity=${granularity}`,
    { getAccessToken, signal },
  );
}

// Serie de ingresos del gráfico del Dashboard (§33), con la misma granularidad
// que el resumen. Las ventanas las sigue fijando el backend con su propio
// reloj.
export function getRevenueSeries(
  granularity: OpportunityRevenueGranularity,
  signal?: AbortSignal,
): Promise<OpportunityRevenueSeries> {
  return request<OpportunityRevenueSeries>(
    `/opportunities/revenue-series?granularity=${granularity}`,
    { getAccessToken, signal },
  );
}
