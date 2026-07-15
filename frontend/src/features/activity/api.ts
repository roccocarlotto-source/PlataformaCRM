import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Activity,
  ActivityListQuery,
  ActivityListResponse,
  CreateActivityInput,
  UpdateActivityInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente propio.
// organizationId nunca viaja acá: se resuelve exclusivamente server-side
// desde el JWT.
function buildListQueryString(query: ActivityListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.type) params.set("type", query.type);
  if (query.authorId) params.set("authorId", query.authorId);
  if (query.assigneeId) params.set("assigneeId", query.assigneeId);
  if (query.companyId) params.set("companyId", query.companyId);
  if (query.contactId) params.set("contactId", query.contactId);
  if (query.opportunityId) params.set("opportunityId", query.opportunityId);
  if (query.dueDateFrom) params.set("dueDateFrom", query.dueDateFrom);
  if (query.dueDateTo) params.set("dueDateTo", query.dueDateTo);
  if (query.completedAtFrom) params.set("completedAtFrom", query.completedAtFrom);
  if (query.completedAtTo) params.set("completedAtTo", query.completedAtTo);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listActivities(
  query: ActivityListQuery,
  signal?: AbortSignal,
): Promise<ActivityListResponse> {
  return request<ActivityListResponse>(`/activities${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getActivity(id: string, signal?: AbortSignal): Promise<Activity> {
  return request<Activity>(`/activities/${id}`, { getAccessToken, signal });
}

export function createActivity(input: CreateActivityInput): Promise<Activity> {
  return request<Activity>("/activities", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateActivity(id: string, input: UpdateActivityInput): Promise<Activity> {
  return request<Activity>(`/activities/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteActivity(id: string): Promise<void> {
  return request<void>(`/activities/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
