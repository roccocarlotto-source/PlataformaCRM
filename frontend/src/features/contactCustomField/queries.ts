import { queryOptions, useQuery } from "@tanstack/react-query";
import { getContactCustomField, listContactCustomFields } from "./api";

export const contactCustomFieldKeys = {
  all: ["contact-custom-fields"] as const,
  lists: () => [...contactCustomFieldKeys.all, "list"] as const,
  details: () => [...contactCustomFieldKeys.all, "detail"] as const,
  detail: (id: string) => [...contactCustomFieldKeys.details(), id] as const,
};

// Las definiciones de la organización. Las usa la pantalla de administración
// y la ficha del contacto (que las muestra a todos los roles).
// Como opciones y no solo como hook: la ficha del contacto la precarga
// (ContactFormPage) con la misma clave que usa ContactCustomFieldsCard.
export function contactCustomFieldsQuery() {
  return queryOptions({
    queryKey: contactCustomFieldKeys.lists(),
    queryFn: ({ signal }) => listContactCustomFields(signal),
  });
}

export function useContactCustomFields() {
  return useQuery(contactCustomFieldsQuery());
}

export function useContactCustomField(id: string | undefined) {
  return useQuery({
    queryKey: contactCustomFieldKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getContactCustomField(id ?? "", signal),
    enabled: id !== undefined,
  });
}
