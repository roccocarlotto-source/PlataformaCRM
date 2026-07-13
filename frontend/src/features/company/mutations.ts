import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCompany, deleteCompany, updateCompany } from "./api";
import { companyKeys } from "./queries";
import type { CreateCompanyInput, UpdateCompanyInput } from "./types";

// Invalidación mínima y correcta: cada mutación solo invalida las queries de
// Company que efectivamente pudo afectar. Nunca queryClient.clear() global
// acá — eso es exclusivo de la frontera de identidad de AuthContext
// (login/logout/cambio de sesión), no de una escritura de negocio normal.

export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) => createCompany(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKeys.lists() });
    },
  });
}

export function useUpdateCompany(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanyInput) => updateCompany(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: companyKeys.detail(id) });
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKeys.lists() });
    },
  });
}
