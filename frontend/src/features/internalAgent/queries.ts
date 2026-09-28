import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getInternalAgent, listInternalAgentMessages } from "./api";

// Sin namespacing por organizationId/userId: la higiene de cache entre
// identidades la da queryClient.clear() en la frontera de AuthContext.
export const internalAgentKeys = {
  all: ["internalAgent"] as const,
  config: () => [...internalAgentKeys.all, "config"] as const,
  messages: () => [...internalAgentKeys.all, "messages"] as const,
};

// La página más reciente trae 50 mensajes (el default del backend); "Ver
// mensajes anteriores" pide la siguiente.
export const INTERNAL_AGENT_MESSAGES_PAGE_SIZE = 50;

export function useInternalAgentConfig() {
  return useQuery({
    queryKey: internalAgentKeys.config(),
    queryFn: ({ signal }) => getInternalAgent(signal),
  });
}

// useInfiniteQuery y no un useQuery por página: el chat ACUMULA páginas (la
// primera al montar, las más viejas a pedido) y las muestra juntas. Cada
// página llega "lo más nuevo primero"; darlas vuelta es cosa de la pantalla.
export function useInternalAgentMessages() {
  return useInfiniteQuery({
    queryKey: internalAgentKeys.messages(),
    queryFn: ({ pageParam, signal }) =>
      listInternalAgentMessages(
        { page: pageParam, pageSize: INTERNAL_AGENT_MESSAGES_PAGE_SIZE },
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
}
