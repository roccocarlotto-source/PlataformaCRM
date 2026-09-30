import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  closeConversation,
  generateConversationBrief,
  replyToConversation,
  retryConversationMessage,
  returnConversationToAgent,
  updateConversationBrief,
} from "./api";
import { conversationKeys } from "./queries";
import type { ConversationDetail } from "./types";

// ---------------------------------------------------------------------------
// Las dos escrituras del brief (ítem 73). Este archivo NO EXISTÍA: el ítem 66
// dejó dicho, en api.ts y en queries.ts, que esta feature no tenía ni una
// mutación porque no había una sola escritura del lado del backend. Ahora hay
// dos, y siguen sin abrir la puerta que ese comentario cuidaba — no se crea
// ningún Message, no se responde nada por ningún canal.
//
// LAS DOS ESCRIBEN LA RESPUESTA EN LA CACHE en vez de solo invalidar, y es la
// diferencia con knowledgeBase/mutations.ts: los dos endpoints devuelven la
// conversación ENTERA con su hilo —la misma forma que sirve el GET del
// detalle—, así que un `setQueryData` deja la pantalla al día sin una segunda
// vuelta al servidor. En el caso de "Generar" eso además importa por lo que
// tarda: refetchear después de una llamada al modelo sería hacer esperar de
// nuevo a quien ya esperó.
//
// EL LISTADO SÍ SE INVALIDA, porque muestra el brief truncado bajo el nombre
// del contacto y no hay forma de parchear la página correcta a mano: las
// claves del listado incluyen los filtros y la página, así que puede haber
// varias en la cache.
// ---------------------------------------------------------------------------

// El onSuccess es idéntico en las tres y sale de un solo lado: las tres
// devuelven la misma conversación actualizada, así que dejar la cache al día
// significa exactamente lo mismo para todas (el cierre es del ítem 168).
function useGuardarEnCache(id: string) {
  const queryClient = useQueryClient();
  return (conversation: ConversationDetail) => {
    queryClient.setQueryData(conversationKeys.detail(id), conversation);
    queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
  };
}

// La edición a mano. `null` vacía el resumen y lo devuelve al estado en el que
// la pantalla vuelve a ofrecer generarlo.
export function useUpdateConversationBrief(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: (brief: string | null) => updateConversationBrief(id, brief),
    onSuccess: guardarEnCache,
  });
}

// Generar y regenerar son LA MISMA operación y el mismo endpoint: la única
// diferencia está en la pantalla, que dice una palabra u otra según haya o no
// un brief. Regenerar pisa lo que hubiera, incluida una edición a mano, y esa
// decisión vive en el backend (ver conversationBrief.service.ts) — acá no se
// repite.
export function useGenerateConversationBrief(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: () => generateConversationBrief(id),
    onSuccess: guardarEnCache,
  });
}

// El cierre manual (ítem 168). Mismo onSuccess que el brief: la respuesta es
// la conversación entera, y el listado se invalida porque muestra el status
// por fila (y puede estar filtrado por status, así que la fila tiene que
// poder desaparecer de "Activas").
export function useCloseConversation(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: () => closeConversation(id),
    onSuccess: guardarEnCache,
  });
}

// Responder desde el CRM (I-03). Mismo onSuccess que el resto: la respuesta
// es la conversación entera, y el listado se invalida porque muestra el
// status y el último mensaje.
export function useReplyToConversation(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: (text: string) => replyToConversation(id, text),
    onSuccess: guardarEnCache,
  });
}

export function useRetryConversationMessage(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: (messageId: string) => retryConversationMessage(id, messageId),
    onSuccess: guardarEnCache,
  });
}

export function useReturnConversationToAgent(id: string) {
  const guardarEnCache = useGuardarEnCache(id);
  return useMutation({
    mutationFn: () => returnConversationToAgent(id),
    onSuccess: guardarEnCache,
  });
}
