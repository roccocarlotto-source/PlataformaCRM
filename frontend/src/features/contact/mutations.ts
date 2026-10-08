import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContact, deleteContact, descartarConsulta, updateContact } from "./api";
import { conversationKeys } from "../conversation/queries";
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

// Descartar una consulta sin identificar (ítem 184): la baja de la pestaña,
// que además cierra sus conversaciones. Invalida también las conversaciones
// porque la bandeja las muestra cerradas desde ese momento.
export function useDescartarConsulta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => descartarConsulta(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.lists() });
      queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}
