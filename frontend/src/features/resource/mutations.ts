import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResource, deleteResource, replaceWorkingHours, updateResource } from "./api";
import { resourceKeys } from "./queries";
import type { CreateResourceInput, UpdateResourceInput, WorkingHoursSlot } from "./types";

// Invalidación mínima y correcta, mismo patrón que Branch: cada mutación solo
// invalida las queries de Resource que efectivamente pudo afectar. Invalidar
// lists() alcanza también a ResourceSelect (usa resourceKeys.list(...)).

export function useCreateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResourceInput) => createResource(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
    },
  });
}

export function useUpdateResource(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateResourceInput) => updateResource(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: resourceKeys.detail(id) });
    },
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.lists() });
    },
  });
}

export function useReplaceWorkingHours(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workingHours: WorkingHoursSlot[]) => replaceWorkingHours(resourceId, workingHours),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceKeys.workingHours(resourceId) });
    },
  });
}
