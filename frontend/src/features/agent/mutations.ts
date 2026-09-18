import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAgent, deleteAgent, updateAgent } from "./api";
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
