import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityListQuery,
  OpportunityListResponse,
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

export function updateOpportunity(
  id: string,
  input: UpdateOpportunityInput,
): Promise<Opportunity> {
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
