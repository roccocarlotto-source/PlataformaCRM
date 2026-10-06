import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  ContactCustomFieldDefinition,
  ContactCustomFieldOptionUsage,
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

// Cuántos contactos tienen elegida cada opción de un campo de lista. Sin
// caché (no es una query): se pide justo antes de guardar, para que la
// confirmación muestre la cantidad de ese momento.
export function getContactCustomFieldOptionUsage(
  id: string,
): Promise<ContactCustomFieldOptionUsage> {
  return request<ContactCustomFieldOptionUsage>(`/contact-custom-fields/${id}/option-usage`, {
    getAccessToken,
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
