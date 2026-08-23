import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateStageInput,
  Stage,
  StageListQuery,
  StageListResponse,
  UpdateStageInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja
// acá: se resuelve exclusivamente server-side desde el JWT.
function buildListQueryString(query: StageListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.pipelineId) params.set("pipelineId", query.pipelineId);
  if (query.search) params.set("search", query.search);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listStages(
  query: StageListQuery,
  signal?: AbortSignal,
): Promise<StageListResponse> {
  return request<StageListResponse>(`/stages${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getStage(id: string, signal?: AbortSignal): Promise<Stage> {
  return request<Stage>(`/stages/${id}`, { getAccessToken, signal });
}

export function createStage(input: CreateStageInput): Promise<Stage> {
  return request<Stage>("/stages", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateStage(id: string, input: UpdateStageInput): Promise<Stage> {
  return request<Stage>(`/stages/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteStage(id: string): Promise<void> {
  return request<void>(`/stages/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
