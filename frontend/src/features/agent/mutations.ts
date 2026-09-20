import { useMutation, useQueryClient } from "@tanstack/react-query";
import { activityKeys } from "../activity/queries";
import { contactKeys } from "../contact/queries";
import { conversationKeys } from "../conversation/queries";
import { opportunityKeys } from "../opportunity/queries";
import {
  createAgent,
  createEmbedToken,
  deleteAgent,
  revokeEmbedToken,
  sendTestMessage,
  updateAgent,
} from "./api";
import { agentKeys } from "./queries";
import type {
  CreateAgentInput,
  TestMessageInput,
  TestMessageResult,
  UpdateAgentInput,
} from "./types";

// Invalidación mínima y correcta, mismo patrón que Branch: cada mutación solo
// invalida las queries de Agent que efectivamente pudo afectar. Nunca
// queryClient.clear() global acá.

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => createAgent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentInput) => updateAgent(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(id) });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// Tokens de embed (ítem 63).
// ---------------------------------------------------------------------------

// EL RESULTADO DE ESTA MUTACIÓN TRAE EL TOKEN EN CLARO — la única vez que
// existe del lado del cliente. No cae en ningún QueryCache (la lista se
// refresca por invalidación, que trae la proyección pública sin `token`),
// pero SÍ quedaría en el MutationCache como `.data` hasta que el gcTime lo
// recoja: es el hallazgo S2-4 de docs/review-fase2-2026-08-28.md, el mismo
// que tiene useCreateApiKey.
//
// Acá el llamador lo resuelve un paso antes que ApiKeyListPage: copia el
// token a su propio estado y llama a `reset()` en el acto (ver
// AgentEmbedPage), así el token vive en UN solo lugar —el estado de React de
// la pantalla— en vez de en dos. No se puede hacer adentro de este hook: no
// sabe cuándo el consumidor terminó de leerlo.
export function useCreateEmbedToken(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createEmbedToken(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.embedTokens(agentId) });
    },
  });
}

// onSettled y no onSuccess: el 409 de "este token ya fue revocado" significa
// que OTRO lo revocó (otra pestaña, otro ADMIN, o la cascada de borrar el
// agente) — o sea que la lista en pantalla está desactualizada justamente
// cuando falla. Refrescarla también en el error es lo que hace que el
// mensaje y la tabla digan lo mismo.
export function useRevokeEmbedToken(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeEmbedToken(agentId, tokenId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.embedTokens(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Un turno de prueba contra el agente (ítem 65).
//
// ES LA ÚNICA MUTACIÓN DEL PROYECTO QUE INVALIDA FUERA DE SU PROPIO FEATURE, y
// no es una licencia: es la consecuencia directa de que este endpoint NO sea
// un sandbox. Un turno puede crear una Oportunidad (create_opportunity),
// escribir los campos de calificación del Contacto (create_lead/update_lead) o
// crear una Activity de derivación — datos que otras pantallas ya tienen
// cacheados. Mismo criterio que useCreateDelivery invalidando vehicleKeys: se
// invalida lo que la escritura realmente pudo tocar, esté donde esté.
//
// SOLO CUANDO ALGO PASÓ DE VERDAD: un turno en el que el modelo contestó y no
// ejecutó ninguna tool no escribió nada fuera de la conversación, y tirar tres
// invalidaciones por cada mensaje de una charla de prueba sería trabajo de red
// por nada. `hayEfectos` mira las tools EJECUTADAS (allowed + result), no las
// pedidas: una bloqueada por los guardrails no llegó a correr.
//
// LA CONVERSACIÓN SÍ SE INVALIDA, Y SIEMPRE — desde el ítem 66. Hasta ese
// ítem no había nada que invalidar (no existía ningún GET de
// Conversation/Message en el backend); ahora existe la bandeja, y un turno
// persiste como mínimo el mensaje entrante, aunque el modelo no conteste y no
// ejecute ninguna tool. Por eso esta invalidación va ANTES del corte por
// efectos y no adentro: no depende de que haya pasado algo más.
function hayEfectosFueraDeLaConversacion(resultado: TestMessageResult): boolean {
  return resultado.handoff || resultado.toolCalls.some((llamada) => llamada.result !== undefined);
}

export function useTestMessage(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TestMessageInput) => sendTestMessage(agentId, input),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all });
      if (!hayEfectosFueraDeLaConversacion(resultado)) return;
      queryClient.invalidateQueries({ queryKey: opportunityKeys.all });
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}
