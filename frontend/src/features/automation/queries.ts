import { useQuery } from "@tanstack/react-query";
import { getAutomation, listAutomations } from "./api";
import type { AutomationListQuery } from "./types";

// Misma forma jerárquica que knowledgeBaseKeys/agentKeys. Sin namespacing
// manual por organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const automationKeys = {
  all: ["automations"] as const,
  lists: () => [...automationKeys.all, "list"] as const,
  list: (query: AutomationListQuery) => [...automationKeys.lists(), query] as const,
  details: () => [...automationKeys.all, "detail"] as const,
  detail: (id: string) => [...automationKeys.details(), id] as const,
};

export function useAutomations(query: AutomationListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: automationKeys.list(query),
    queryFn: ({ signal }) => listAutomations(query, signal),
    enabled: options?.enabled,
  });
}

// Único consumidor hoy: el formulario de edición. No hay ningún selector que
// otra pantalla consuma — por eso el módulo entero vive dentro de AdminRoute
// (ver el comentario de /automations en app/router.tsx).
export function useAutomation(id: string | undefined) {
  return useQuery({
    queryKey: automationKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getAutomation(id ?? "", signal),
    enabled: id !== undefined,
  });
}
