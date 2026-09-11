import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Branch,
  BranchListQuery,
  BranchListResponse,
  CreateBranchInput,
  UpdateBranchInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja acá:
// se resuelve exclusivamente server-side desde el JWT.
function buildListQueryString(query: BranchListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listBranches(
  query: BranchListQuery,
  signal?: AbortSignal,
): Promise<BranchListResponse> {
  return request<BranchListResponse>(`/branches${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

// Único consumidor: el formulario de edición (BranchFormPage). BranchSelect y
// QrListPage siguen resolviendo nombres contra la lista, como antes.
export function getBranch(id: string, signal?: AbortSignal): Promise<Branch> {
  return request<Branch>(`/branches/${id}`, { getAccessToken, signal });
}

export function createBranch(input: CreateBranchInput): Promise<Branch> {
  return request<Branch>("/branches", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateBranch(id: string, input: UpdateBranchInput): Promise<Branch> {
  return request<Branch>(`/branches/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

// 204 sin body — request() devuelve undefined en ese caso. El 400 del RESTRICT
// (recursos/servicios/QRs activos o Google Calendar conectado) llega como
// rechazo con el mensaje del backend, que la pantalla muestra tal cual.
export function deleteBranch(id: string): Promise<void> {
  return request<void>(`/branches/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
