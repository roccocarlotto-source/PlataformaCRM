import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { UserListQuery, UserListResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja
// acá: se resuelve exclusivamente server-side desde el JWT.
//
// Sin getUser(id): GET /api/users/:id no existe en el backend
// (user.routes.ts solo expone GET /users (list), PATCH/DELETE /users/:id) —
// a diferencia de Company/Contact/Pipeline/Stage, no hay forma de resolver
// un User por id individualmente. Ver opportunity/relationResolution.ts
// para cómo se resuelve el nombre del owner sin ese endpoint.
function buildListQueryString(query: UserListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.role) params.set("role", query.role);
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listUsers(
  query: UserListQuery,
  signal?: AbortSignal,
): Promise<UserListResponse> {
  return request<UserListResponse>(`/users${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}
