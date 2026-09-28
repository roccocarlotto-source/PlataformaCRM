import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWhatsappTemplate, deleteWhatsappTemplate, refreshWhatsappTemplate } from "./api";
import { whatsappTemplateKeys } from "./queries";
import type { CreateWhatsappTemplateInput, WhatsappTemplate } from "./types";

// Las tres devuelven (o dejan) el estado final de la plantilla de UNA regla,
// así que se escribe directo en su entrada de la cache en vez de invalidar y
// esperar otro GET: la pantalla cambia en el mismo instante en que contesta el
// backend, y el listado lo ve al volver.

export function useCreateWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWhatsappTemplateInput) => createWhatsappTemplate(input),
    onSuccess: (plantilla: WhatsappTemplate) => {
      queryClient.setQueryData(
        whatsappTemplateKeys.byAutomation(plantilla.automationId),
        plantilla,
      );
    },
  });
}

// Recibe la plantilla entera y no solo el id: el DELETE es 204 sin body, y la
// regla es lo que dice qué entrada de la cache queda vacía.
export function useDeleteWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plantilla: Pick<WhatsappTemplate, "id" | "automationId">) =>
      deleteWhatsappTemplate(plantilla.id),
    onSuccess: (_resultado, plantilla) => {
      queryClient.setQueryData(whatsappTemplateKeys.byAutomation(plantilla.automationId), null);
    },
  });
}

export function useRefreshWhatsappTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => refreshWhatsappTemplate(id),
    onSuccess: (plantilla: WhatsappTemplate) => {
      queryClient.setQueryData(
        whatsappTemplateKeys.byAutomation(plantilla.automationId),
        plantilla,
      );
    },
  });
}
