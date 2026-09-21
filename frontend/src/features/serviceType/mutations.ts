import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createServiceType, deleteServiceType, updateServiceType } from "./api";
import { serviceTypeKeys } from "./queries";
import type { CreateServiceTypeInput, UpdateServiceTypeInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Resource/Branch.

export function useCreateServiceType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceTypeInput) => createServiceType(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceTypeKeys.lists() });
    },
  });
}

export function useUpdateServiceType(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateServiceTypeInput) => updateServiceType(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceTypeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: serviceTypeKeys.detail(id) });
    },
  });
}

export function useDeleteServiceType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteServiceType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceTypeKeys.lists() });
    },
  });
}
