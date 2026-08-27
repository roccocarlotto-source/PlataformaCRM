import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSource, deleteSource, updateSource } from "./api";
import { sourceKeys } from "./queries";
import type { CreateSourceInput, UpdateSourceInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Company y Contact: cada
// mutación solo invalida las queries de Source que efectivamente pudo afectar.
// Nunca queryClient.clear() global acá.

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSourceInput) => createSource(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.lists() });
    },
  });
}

export function useUpdateSource(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSourceInput) => updateSource(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sourceKeys.detail(id) });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.lists() });
    },
  });
}
