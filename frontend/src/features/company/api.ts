import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Company,
  CompanyListQuery,
  CompanyListResponse,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente Supabase propio,
// sin persistencia manual de tokens. organizationId nunca viaja acá: se
// resuelve exclusivamente server-side desde el JWT (ver types.ts).
function buildListQueryString(query: CompanyListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.industry) params.set("industry", query.industry);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listCompanies(
  query: CompanyListQuery,
  signal?: AbortSignal,
): Promise<CompanyListResponse> {
  return request<CompanyListResponse>(`/companies${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getCompany(id: string, signal?: AbortSignal): Promise<Company> {
  return request<Company>(`/companies/${id}`, { getAccessToken, signal });
}

export function createCompany(input: CreateCompanyInput): Promise<Company> {
  return request<Company>("/companies", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateCompany(id: string, input: UpdateCompanyInput): Promise<Company> {
  return request<Company>(`/companies/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteCompany(id: string): Promise<void> {
  return request<void>(`/companies/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
