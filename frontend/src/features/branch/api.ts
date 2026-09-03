import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { BranchListQuery, BranchListResponse } from "./types";

// Reutiliza request()/getAccessToken tal cual. organizationId nunca viaja acá:
// se resuelve exclusivamente server-side desde el JWT.
//
// Solo el listado. GET /api/branches/:id existe en el backend, pero ningún
// consumidor del frontend lo necesita todavía (el nombre de la sucursal de un
// QR se resuelve contra la misma lista que alimenta el select) — no se agrega
// una función sin llamador.
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
