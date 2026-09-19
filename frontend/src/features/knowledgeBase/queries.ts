import { useQuery } from "@tanstack/react-query";
import { getKnowledgeBaseEntry, listKnowledgeBaseEntries } from "./api";
import type { KnowledgeBaseListQuery } from "./types";

// Misma forma jerárquica que agentKeys/branchKeys. Sin namespacing manual por
// organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const knowledgeBaseKeys = {
  all: ["knowledge-base"] as const,
  lists: () => [...knowledgeBaseKeys.all, "list"] as const,
  list: (query: KnowledgeBaseListQuery) => [...knowledgeBaseKeys.lists(), query] as const,
  details: () => [...knowledgeBaseKeys.all, "detail"] as const,
  detail: (id: string) => [...knowledgeBaseKeys.details(), id] as const,
};

export function useKnowledgeBaseEntries(
  query: KnowledgeBaseListQuery,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: knowledgeBaseKeys.list(query),
    queryFn: ({ signal }) => listKnowledgeBaseEntries(query, signal),
    enabled: options?.enabled,
  });
}

// Único consumidor hoy: el formulario de edición. No hay ningún selector que
// otra pantalla consuma — por eso el módulo entero vive dentro de AdminRoute
// (ver el comentario de /knowledge-base en app/router.tsx).
export function useKnowledgeBaseEntry(id: string | undefined) {
  return useQuery({
    queryKey: knowledgeBaseKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getKnowledgeBaseEntry(id ?? "", signal),
    enabled: id !== undefined,
  });
}
