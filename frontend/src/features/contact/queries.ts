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

export function useContacts(query: ContactListQuery) {
  return useQuery({
    queryKey: contactKeys.list(query),
    queryFn: ({ signal }) => listContacts(query, signal),
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: contactKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getContact(id ?? "", signal),
    enabled: id !== undefined,
  });
}
