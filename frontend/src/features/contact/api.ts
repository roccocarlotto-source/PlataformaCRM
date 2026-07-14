import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  Contact,
  ContactListQuery,
  ContactListResponse,
  CreateContactInput,
  UpdateContactInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual — sin cliente Supabase propio,
// sin persistencia manual de tokens. organizationId nunca viaja acá: se
// resuelve exclusivamente server-side desde el JWT (ver types.ts).
function buildListQueryString(query: ContactListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.companyId) params.set("companyId", query.companyId);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (query.lifecycleStage) params.set("lifecycleStage", query.lifecycleStage);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function listContacts(
  query: ContactListQuery,
  signal?: AbortSignal,
): Promise<ContactListResponse> {
  return request<ContactListResponse>(`/contacts${buildListQueryString(query)}`, {
    getAccessToken,
    signal,
  });
}

export function getContact(id: string, signal?: AbortSignal): Promise<Contact> {
  return request<Contact>(`/contacts/${id}`, { getAccessToken, signal });
}

export function createContact(input: CreateContactInput): Promise<Contact> {
  return request<Contact>("/contacts", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateContact(id: string, input: UpdateContactInput): Promise<Contact> {
  return request<Contact>(`/contacts/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteContact(id: string): Promise<void> {
  return request<void>(`/contacts/${id}`, {
    method: "DELETE",
    getAccessToken,
  });
}
