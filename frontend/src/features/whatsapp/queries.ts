import { useQuery } from "@tanstack/react-query";
import { getCurrentWhatsappTemplate } from "./api";

// Una sola clave: la plantilla es un singleton por organización, igual que
// organizationKeys.settings. Sin namespacing por organizationId por el mismo
// motivo: la higiene de cache entre identidades la da queryClient.clear() en
// la frontera de AuthContext.
export const whatsappTemplateKeys = {
  all: ["whatsappTemplate"] as const,
  current: () => [...whatsappTemplateKeys.all, "current"] as const,
};

export function useCurrentWhatsappTemplate() {
  return useQuery({
    queryKey: whatsappTemplateKeys.current(),
    queryFn: ({ signal }) => getCurrentWhatsappTemplate(signal),
  });
}
