import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContactCustomField,
  deleteContactCustomField,
  updateContactCustomField,
} from "./api";
import { contactCustomFieldKeys } from "./queries";
import type { CreateContactCustomFieldInput, UpdateContactCustomFieldInput } from "./types";

// Invalidación mínima, mismo patrón que serviceType/mutations.ts.

export function useCreateContactCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactCustomFieldInput) => createContactCustomField(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactCustomFieldKeys.lists() });
    },
  });
}

export function useUpdateContactCustomField(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateContactCustomFieldInput) => updateContactCustomField(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactCustomFieldKeys.lists() });
      queryClient.invalidateQueries({ queryKey: contactCustomFieldKeys.detail(id) });
    },
  });
}

export function useDeleteContactCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContactCustomField(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactCustomFieldKeys.lists() });
    },
  });
}
