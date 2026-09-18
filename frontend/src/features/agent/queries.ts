import { useQuery } from "@tanstack/react-query";
import { getAgent, listAgents } from "./api";
import type { AgentListQuery } from "./types";

// Misma forma jerárquica que branchKeys/sourceKeys. Sin namespacing manual por
// organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (query: AgentListQuery) => [...agentKeys.lists(), query] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

export function useAgents(query: AgentListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentKeys.list(query),
    queryFn: ({ signal }) => listAgents(query, signal),
    enabled: options?.enabled,
  });
}

// Único consumidor hoy: el formulario de edición. No hay ningún AgentSelect
// que otra pantalla consuma — por eso el módulo entero vive dentro de
// AdminRoute (ver el comentario de /agents en app/router.tsx).
export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: agentKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getAgent(id ?? "", signal),
    enabled: id !== undefined,
  });
}
