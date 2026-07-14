import { useQuery } from "@tanstack/react-query";
import { getContact, listContacts } from "./api";
import type { ContactListQuery } from "./types";

// Mismo criterio que companyKeys (M2): sin namespacing manual por
// organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const contactKeys = {
  all: ["contacts"] as const,
  lists: () => [...contactKeys.all, "list"] as const,
  list: (query: ContactListQuery) => [...contactKeys.lists(), query] as const,
  details: () => [...contactKeys.all, "detail"] as const,
  detail: (id: string) => [...contactKeys.details(), id] as const,
};

// options.enabled — agregado en M5 (opportunity/ContactSelect.tsx): mismo
// motivo que CompanySelect necesitó en useCompanies (M2) — un selector de
// Contact con búsqueda server-side no debe precargar un listado por
// default, solo buscar cuando hay término. undefined (sin pasar options)
// se comporta como antes (enabled=true), así que no cambia ningún caller
// existente (ContactListPage no lo pasa).
export function useContacts(query: ContactListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: contactKeys.list(query),
    queryFn: ({ signal }) => listContacts(query, signal),
    enabled: options?.enabled,
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: contactKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getContact(id ?? "", signal),
    enabled: id !== undefined,
  });
}
