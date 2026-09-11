import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBranch, deleteBranch, updateBranch } from "./api";
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
