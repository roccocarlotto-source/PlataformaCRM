import { useQuery } from "@tanstack/react-query";
import { getCompany, listCompanies } from "./api";
import type { CompanyListQuery } from "./types";

// Query keys explícitas y estables — no namespacing manual por
// organizationId (ver docs/project-overview.md, sección multi-tenant de
// M1/M2): la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext, sin necesidad de
// repetirla acá.
export const companyKeys = {
  all: ["companies"] as const,
  lists: () => [...companyKeys.all, "list"] as const,
  list: (query: CompanyListQuery) => [...companyKeys.lists(), query] as const,
  details: () => [...companyKeys.all, "detail"] as const,
  detail: (id: string) => [...companyKeys.details(), id] as const,
};

export function useCompanies(query: CompanyListQuery) {
  return useQuery({
    queryKey: companyKeys.list(query),
    queryFn: ({ signal }) => listCompanies(query, signal),
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: companyKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getCompany(id ?? "", signal),
    enabled: id !== undefined,
  });
}
