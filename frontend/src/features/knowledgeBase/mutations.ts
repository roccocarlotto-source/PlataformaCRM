import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
} from "./api";
import { knowledgeBaseKeys } from "./queries";
import type { CreateKnowledgeBaseEntryInput, UpdateKnowledgeBaseEntryInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Agent y Branch: cada
// mutación solo invalida las queries de este módulo que efectivamente pudo
// afectar. Nunca queryClient.clear() global acá.

export function useCreateKnowledgeBaseEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKnowledgeBaseEntryInput) => createKnowledgeBaseEntry(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.lists() });
    },
  });
}

export function useUpdateKnowledgeBaseEntry(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateKnowledgeBaseEntryInput) => updateKnowledgeBaseEntry(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.detail(id) });
    },
  });
}

export function useDeleteKnowledgeBaseEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.lists() });
    },
  });
}
