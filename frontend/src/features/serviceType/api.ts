import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CreateServiceTypeInput,
  ServiceType,
  ServiceTypeListQuery,
  ServiceTypeListResponse,
  UpdateServiceTypeInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/resource/api.ts. organizationId nunca viaja acá.
function buildListQueryString(query: ServiceTypeListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branchId", query.branchId);
  if (query.resourceId) params.set("resourceId", query.resourceId);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listServiceTypes(
  query: ServiceTypeListQuery,
  signal?: AbortSignal,
): Promise<ServiceTypeListResponse> {
  return request<ServiceTypeListResponse>(`/service-types${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getServiceType(id: string, signal?: AbortSignal): Promise<ServiceType> {
  return request<ServiceType>(`/service-types/${id}`, { getAccessToken, signal });
}

export function createServiceType(input: CreateServiceTypeInput): Promise<ServiceType> {
  return request<ServiceType>("/service-types", { method: "POST", body: input, getAccessToken });
}

export function updateServiceType(id: string, input: UpdateServiceTypeInput): Promise<ServiceType> {
  return request<ServiceType>(`/service-types/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body. El 400 del RESTRICT (reservas activas) llega con el mensaje
// del backend, que la pantalla muestra tal cual.
export function deleteServiceType(id: string): Promise<void> {
  return request<void>(`/service-types/${id}`, { method: "DELETE", getAccessToken });
}
