import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContact,
  deleteContact,
  descartarConsulta,
  erasePersonalData,
  updateContact,
} from "./api";
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

// Borrado de datos personales: cambia la ficha, la lista y la bandeja de
// conversaciones (las del contacto quedan cerradas y sin texto).
export function useErasePersonalData(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => erasePersonalData(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.lists() });
      queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

// Las dos pestañas de la lista (Clientes y Consultas sin identificar) cuelgan
// de contactKeys.lists() y comparten esta forma.
type ListaDeContactos = { data: { id: string }[] };

/** Borrar saca la fila de la lista en el momento (actualización optimista):
 *  sin esto, la fila seguía ahí hasta que volvían el DELETE y la lista nueva,
 *  ~7 s en producción, y parecía que no había pasado nada. Si el servidor lo
 *  rechaza, la fila vuelve. */
export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: contactKeys.lists() });
      const antes = queryClient.getQueriesData<ListaDeContactos>({
        queryKey: contactKeys.lists(),
      });
      queryClient.setQueriesData<ListaDeContactos>({ queryKey: contactKeys.lists() }, (lista) =>
        lista ? { ...lista, data: lista.data.filter((c) => c.id !== id) } : lista,
      );
      return { antes };
    },
    onError: (_error, _id, contexto) => {
      for (const [clave, datos] of contexto?.antes ?? []) queryClient.setQueryData(clave, datos);
    },
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
