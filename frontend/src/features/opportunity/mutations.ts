import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "./api";
import { opportunityKeys } from "./queries";
import type { CreateOpportunityInput, UpdateOpportunityInput } from "./types";

// Invalidación selectiva pura — a diferencia de Pipeline/Stage, ninguna
// mutación de Opportunity escribe sobre otra tabla
// (opportunity.repository.ts: createOpportunity/updateOpportunity/
// softDeleteOpportunity tocan exclusivamente db.opportunity). Sin efecto
// lateral real demostrado, nunca se invalida companyKeys/contactKeys/
// pipelineKeys/stageKeys/userKeys desde acá.

export function useCreateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpportunityInput) => createOpportunity(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: opportunityKeys.lists() });
    },
  });
}

export function useUpdateOpportunity(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOpportunityInput) => updateOpportunity(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: opportunityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: opportunityKeys.detail(id) });
    },
  });
}

export function useDeleteOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOpportunity(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: opportunityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: opportunityKeys.detail(id) });
    },
  });
}
