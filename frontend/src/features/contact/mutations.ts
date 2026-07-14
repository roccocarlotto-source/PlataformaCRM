import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContact, deleteContact, updateContact } from "./api";
import { contactKeys } from "./queries";
import type { CreateContactInput, UpdateContactInput } from "./types";

// Invalidación mínima y correcta, mismo patrón que Company (M2): cada
// mutación solo invalida las queries de Contact que efectivamente pudo
// afectar. Nunca queryClient.clear() global acá.

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactInput) => createContact(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.lists() });
    },
  });
}

export function useUpdateContact(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateContactInput) => updateContact(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.lists() });
      queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.lists() });
    },
  });
}
