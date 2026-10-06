import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  ContactCustomFieldDefinition,
  CreateContactCustomFieldInput,
  UpdateContactCustomFieldInput,
} from "./types";

// Reutiliza request()/getAccessToken tal cual, mismo patrón que
// features/serviceType/api.ts. Sin paginación: son a lo sumo 30 por organización.

export function listContactCustomFields(
  signal?: AbortSignal,
): Promise<ContactCustomFieldDefinition[]> {
  return request<ContactCustomFieldDefinition[]>("/contact-custom-fields", {
    getAccessToken,
    signal,
  });
}

export function getContactCustomField(
  id: string,
  signal?: AbortSignal,
): Promise<ContactCustomFieldDefinition> {
  return request<ContactCustomFieldDefinition>(`/contact-custom-fields/${id}`, {
    getAccessToken,
    signal,
  });
}

export function createContactCustomField(
  input: CreateContactCustomFieldInput,
): Promise<ContactCustomFieldDefinition> {
  return request<ContactCustomFieldDefinition>("/contact-custom-fields", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function updateContactCustomField(
  id: string,
  input: UpdateContactCustomFieldInput,
): Promise<ContactCustomFieldDefinition> {
  return request<ContactCustomFieldDefinition>(`/contact-custom-fields/${id}`, {
    method: "PATCH",
    body: input,
    getAccessToken,
  });
}

export function deleteContactCustomField(id: string): Promise<void> {
  return request<void>(`/contact-custom-fields/${id}`, { method: "DELETE", getAccessToken });
}
