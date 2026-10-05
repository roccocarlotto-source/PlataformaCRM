import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { putInternalAgent, sendInternalAgentMessage } from "./api";
import { internalAgentKeys } from "./queries";
import type {
  InternalAgent,
  InternalAgentMessage,
  InternalAgentMessageListResponse,
  PutInternalAgentInput,
} from "./types";

// El PUT devuelve el registro completo: se escribe directo en la cache, mismo
// criterio que la plantilla de WhatsApp. El historial también se invalida: con
// un agente recién creado, un chat que había quedado en "no configurado" deja
// de estarlo.
export function usePutInternalAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PutInternalAgentInput) => putInternalAgent(input),
    onSuccess: (agente: InternalAgent) => {
      queryClient.setQueryData(internalAgentKeys.config(), agente);
      // /api/me dice si hay agente interno: recién creado, hay que releerlo
      // para que el chat empiece a pedir sus mensajes.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: internalAgentKeys.messages() });
    },
  });
}

// El backend devuelve SOLO el mensaje del agente; el del usuario no vuelve.
// Al terminar el turno se meten los dos al principio de la primera página (el
// del usuario con un id local) para que el hilo quede completo en el mismo
// render en que desaparece el "escribiendo", y se invalida para que el refetch
// lo reemplace por lo que guardó el backend (con el id real).
export function useSendInternalAgentMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sendInternalAgentMessage(content),
    onSuccess: (respuesta: InternalAgentMessage, content: string) => {
      const delUsuario: InternalAgentMessage = {
        ...respuesta,
        id: `local-${respuesta.id}`,
        senderType: "USER",
        content,
        toolCalls: null,
      };
      queryClient.setQueryData<InfiniteData<InternalAgentMessageListResponse>>(
        internalAgentKeys.messages(),
        (actual) => {
          if (!actual || actual.pages.length === 0) return actual;
          const [primera, ...resto] = actual.pages;
          return {
            ...actual,
            pages: [{ ...primera, data: [respuesta, delUsuario, ...primera.data] }, ...resto],
          };
        },
      );
      void queryClient.invalidateQueries({ queryKey: internalAgentKeys.messages() });
    },
  });
}
