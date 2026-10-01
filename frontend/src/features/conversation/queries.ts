import { useQuery } from "@tanstack/react-query";
import { getConversation, listConversations } from "./api";
import type { ConversationListQuery } from "./types";

// Misma forma jerárquica que agentKeys/knowledgeBaseKeys. Sin namespacing
// manual por organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
//
// Las mutaciones de esta feature (brief, cierre, responder) escriben su
// respuesta en la cache del detalle (ver mutations.ts). Lo que cambia por
// fuera —un turno del agente, un mensaje nuevo del cliente— ocurre del lado
// del servidor, y se trae con polling: cada 5 s el detalle abierto y cada
// 10 s la lista. Sin refetchIntervalInBackground: con la pestaña oculta no
// corre, y al volver a ella refetchOnWindowFocus ya la pone al día.
//
// El polling no pisa lo que el vendedor está escribiendo: el borrador de
// "Responder" es estado local de ConversationReplyCard, que sigue montada
// durante un refetch (ver la cabecera de ConversationDetail).
export const DETAIL_REFETCH_MS = 5_000;
export const LIST_REFETCH_MS = 10_000;

export const conversationKeys = {
  all: ["conversations"] as const,
  lists: () => [...conversationKeys.all, "list"] as const,
  list: (query: ConversationListQuery) => [...conversationKeys.lists(), query] as const,
  details: () => [...conversationKeys.all, "detail"] as const,
  detail: (id: string) => [...conversationKeys.details(), id] as const,
};

export function useConversations(query: ConversationListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: conversationKeys.list(query),
    queryFn: ({ signal }) => listConversations(query, signal),
    enabled: options?.enabled,
    refetchInterval: LIST_REFETCH_MS,
  });
}

// El detalle trae el hilo completo en la misma respuesta: no hay una segunda
// query de mensajes que coordinar.
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getConversation(id ?? "", signal),
    enabled: id !== undefined,
    refetchInterval: DETAIL_REFETCH_MS,
  });
}
