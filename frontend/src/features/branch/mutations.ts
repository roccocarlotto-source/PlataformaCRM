import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createBranch,
  deleteBranch,
  disconnectGoogleCalendar,
  startGoogleCalendarConnection,
  updateBranch,
} from "./api";
import { branchKeys } from "./queries";
import type { CreateBranchInput, UpdateBranchInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Source: cada mutación solo
// invalida las queries de Branch que efectivamente pudo afectar. Invalidar
// lists() alcanza también para BranchSelect (usa branchKeys.list(...)), así
// que una sucursal nueva aparece en los selectores de QR y Vehículo sin más
// trabajo. Nunca queryClient.clear() global acá.

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBranchInput) => createBranch(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
    },
  });
}

export function useUpdateBranch(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBranchInput) => updateBranch(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
      queryClient.invalidateQueries({ queryKey: branchKeys.detail(id) });
    },
  });
}

export function useDeleteBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBranch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
    },
  });
}

// Iniciar la conexión no cambia nada todavía (solo firma el state y devuelve
// la URL de Google): no hay nada que invalidar. El cambio real ocurre en el
// callback, en otra pestaña; la sección lo ve al volver a consultar.
export function useStartGoogleCalendarConnection(branchId: string) {
  return useMutation({
    mutationFn: () => startGoogleCalendarConnection(branchId),
  });
}

export function useDisconnectGoogleCalendar(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectGoogleCalendar(branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: branchKeys.googleCalendar(branchId) });
    },
  });
}
