import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreatePipelineInput,
  Pipeline,
  PipelineListQuery,
  PipelineListResponse,
  UpdatePipelineInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente Supabase propio,
// sin persistencia manual de tokens. organizationId nunca viaja acá: se
// resuelve exclusivamente server-side desde el JWT.
function buildListQueryString(query: PipelineListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listPipelines(
  query: PipelineListQuery,
  signal?: AbortSignal,
): Promise<PipelineListResponse> {
  return request<PipelineListResponse>(`/pipelines${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getPipeline(id: string, signal?: AbortSignal): Promise<Pipeline> {
  return request<Pipeline>(`/pipelines/${id}`, { getAccessToken, signal });
}

export function createPipeline(input: CreatePipelineInput): Promise<Pipeline> {
  return request<Pipeline>("/pipelines", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updatePipeline(id: string, input: UpdatePipelineInput): Promise<Pipeline> {
  return request<Pipeline>(`/pipelines/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deletePipeline(id: string): Promise<void> {
  return request<void>(`/pipelines/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
