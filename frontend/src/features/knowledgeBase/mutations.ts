import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  syncKnowledgeBaseVehicles,
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

// §70 — una corrida de la sincronización escribe, actualiza y da de baja
// entradas de una sucursal, así que invalida los listados como cualquier otra
// escritura del módulo. No hay detalle que invalidar: la pantalla que la
// dispara es el listado, y ninguna entrada puntual está abierta.
export function useSyncKnowledgeBaseVehicles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) => syncKnowledgeBaseVehicles(branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.lists() });
    },
  });
}
