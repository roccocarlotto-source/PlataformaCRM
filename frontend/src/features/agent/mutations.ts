import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAgent, createEmbedToken, deleteAgent, revokeEmbedToken, updateAgent } from "./api";
import { agentKeys } from "./queries";
import type { CreateAgentInput, UpdateAgentInput } from "./types";

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
