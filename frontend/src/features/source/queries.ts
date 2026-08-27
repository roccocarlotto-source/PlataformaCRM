import { useQuery } from "@tanstack/react-query";
import { getSource, listSources } from "./api";
import type { SourceListQuery } from "./types";

// Misma forma jerárquica que companyKeys/contactKeys, y por el mismo motivo:
// sin namespacing manual por organizationId — la higiene de cache entre
// identidades ya la da queryClient.clear() en la frontera de AuthContext.
export const sourceKeys = {
  all: ["sources"] as const,
  lists: () => [...sourceKeys.all, "list"] as const,
  list: (query: SourceListQuery) => [...sourceKeys.lists(), query] as const,
  details: () => [...sourceKeys.all, "detail"] as const,
  detail: (id: string) => [...sourceKeys.details(), id] as const,
};

export function useSources(query: SourceListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: sourceKeys.list(query),
    queryFn: ({ signal }) => listSources(query, signal),
    enabled: options?.enabled,
  });
}

export function useSource(id: string | undefined) {
  return useQuery({
    queryKey: sourceKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getSource(id ?? "", signal),
    enabled: id !== undefined,
  });
}
