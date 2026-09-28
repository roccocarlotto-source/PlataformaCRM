import { useQueries, useQuery } from "@tanstack/react-query";
import { getWhatsappTemplate } from "./api";

// Una clave por regla: la plantilla es un singleton por automatización (ítem
// 181). Sin namespacing por organizationId: la higiene de cache entre
// identidades la da queryClient.clear() en la frontera de AuthContext.
export const whatsappTemplateKeys = {
  all: ["whatsappTemplate"] as const,
  byAutomation: (automationId: string) =>
    [...whatsappTemplateKeys.all, "automation", automationId] as const,
};

export function useWhatsappTemplate(automationId: string) {
  return useQuery({
    queryKey: whatsappTemplateKeys.byAutomation(automationId),
    queryFn: ({ signal }) => getWhatsappTemplate(automationId, signal),
  });
}

// La de cada regla del listado, en paralelo y con la MISMA clave que usa la
// pantalla de una regla: entrar a una desde la lista no vuelve a pedirla, y lo
// que las mutaciones escriben en la cache se ve al volver. El conjunto es chico
// por construcción (las reglas que mandan WhatsApp de una organización).
export function useWhatsappTemplatesOf(automationIds: readonly string[]) {
  return useQueries({
    queries: automationIds.map((automationId) => ({
      queryKey: whatsappTemplateKeys.byAutomation(automationId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getWhatsappTemplate(automationId, signal),
    })),
  });
}
