import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWhatsappTemplate, deleteWhatsappTemplate, refreshWhatsappTemplate } from "./api";
import { whatsappTemplateKeys } from "./queries";
import type { CreateWhatsappTemplateInput, WhatsappTemplate } from "./types";

// Las tres devuelven (o dejan) el estado final de la única query del módulo,
// así que se escribe directo en la cache en vez de invalidar y esperar otro
// GET: la pantalla cambia en el mismo instante en que contesta el backend.

export function useCreateWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWhatsappTemplateInput) => createWhatsappTemplate(input),
    onSuccess: (plantilla: WhatsappTemplate) => {
      queryClient.setQueryData(whatsappTemplateKeys.current(), plantilla);
    },
  });
}

export function useDeleteWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWhatsappTemplate(id),
    onSuccess: () => {
      queryClient.setQueryData(whatsappTemplateKeys.current(), null);
    },
  });
}

export function useRefreshWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => refreshWhatsappTemplate(id),
    onSuccess: (plantilla: WhatsappTemplate) => {
      queryClient.setQueryData(whatsappTemplateKeys.current(), plantilla);
    },
  });
}
