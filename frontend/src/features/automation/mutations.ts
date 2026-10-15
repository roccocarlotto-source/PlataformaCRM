import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  refreshWhatsappApproval,
  retryWhatsappTemplate,
  updateAutomation,
} from "./api";
import { automationKeys } from "./queries";
import type { CreateAutomationInput, UpdateAutomationInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Knowledge Base y Agent:
// cada mutación solo invalida las queries de este módulo que efectivamente
// pudo afectar. Nunca queryClient.clear() global acá.

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAutomationInput) => createAutomation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.lists() });
    },
  });
}

export function useUpdateAutomation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAutomationInput) => updateAutomation(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

// El estado nuevo vuelve en la respuesta; el detalle se recarga para que el
// formulario lo muestre.
export function useRefreshWhatsappApproval(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshWhatsappApproval(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

// H-1: "Reintentar". La regla vuelve con el estado nuevo; el detalle y el
// listado se recargan para mostrarlo.
export function useRetryWhatsappTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => retryWhatsappTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: automationKeys.lists() });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.lists() });
    },
  });
}
