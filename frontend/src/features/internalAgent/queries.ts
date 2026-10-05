import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
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

// ¿Hay un agente interno que pedir? /api/me ya lo dice. Con false, ninguna de
// las dos consultas de abajo sale: antes cada visita a estas pantallas dejaba
// un 404 en la consola solo para enterarse de que no había agente.
export function useAgenteInternoConfigurado(): boolean {
  const { me } = useAuth();
  return me?.internalAgentConfigured !== false;
}

export function useInternalAgentConfig() {
  const configurado = useAgenteInternoConfigurado();
  return useQuery({
    queryKey: internalAgentKeys.config(),
    queryFn: ({ signal }) => getInternalAgent(signal),
    enabled: configurado,
  });
}

// useInfiniteQuery y no un useQuery por página: el chat ACUMULA páginas (la
// primera al montar, las más viejas a pedido) y las muestra juntas. Cada
// página llega "lo más nuevo primero"; darlas vuelta es cosa de la pantalla.
export function useInternalAgentMessages() {
  const configurado = useAgenteInternoConfigurado();
  return useInfiniteQuery({
    enabled: configurado,
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
