import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateResourceInput,
  Resource,
  ResourceListQuery,
  ResourceListResponse,
  UpdateResourceInput,
  WorkingHoursPayload,
  WorkingHoursSlot,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/branch/api.ts. organizationId nunca viaja acá: se resuelve
// exclusivamente server-side desde el JWT.
function buildListQueryString(query: ResourceListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.type) params.set("type", query.type);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listResources(
  query: ResourceListQuery,
  signal?: AbortSignal,
): Promise<ResourceListResponse> {
  return request<ResourceListResponse>(`/resources${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getResource(id: string, signal?: AbortSignal): Promise<Resource> {
  return request<Resource>(`/resources/${id}`, { getAccessToken, signal });
}

export function createResource(input: CreateResourceInput): Promise<Resource> {
  return request<Resource>("/resources", { method: "POST", body: input, getAccessToken });
}

export function updateResource(id: string, input: UpdateResourceInput): Promise<Resource> {
  return request<Resource>(`/resources/${id}`, { method: "PATCH", body: input, getAccessToken });
}

// 204 sin body. El 400 del RESTRICT (tipos de servicio activos que usan este
// recurso) llega como rechazo con el mensaje del backend, que la pantalla
// muestra tal cual — mismo criterio que deleteBranch.
export function deleteResource(id: string): Promise<void> {
  return request<void>(`/resources/${id}`, { method: "DELETE", getAccessToken });
}

export function getWorkingHours(
  resourceId: string,
  signal?: AbortSignal,
): Promise<WorkingHoursPayload> {
  return request<WorkingHoursPayload>(`/resources/${resourceId}/working-hours`, {
    getAccessToken,
    signal,
  });
}

// PUT con la semana ENTERA, nunca una franja suelta: lo que no viaja acá deja
// de existir. Un arreglo vacío es válido y significa "este recurso no atiende".
export function replaceWorkingHours(
  resourceId: string,
  workingHours: WorkingHoursSlot[],
): Promise<WorkingHoursPayload> {
  return request<WorkingHoursPayload>(`/resources/${resourceId}/working-hours`, {
    method: "PUT",
    body: { workingHours },
    getAccessToken,
  });
}
