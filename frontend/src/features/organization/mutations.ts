import { useMutation, useQueryClient } from "@tanstack/react-query";
import { guardarMensajesDeSalud, updateOrganizationSettings } from "./api";
import { organizationKeys } from "./queries";
import type { MensajesDeSaludInput, UpdateOrganizationSettingsInput } from "./types";

// Invalidación mínima, mismo patrón que Source/Company: la única query que
// esta mutación puede afectar es la de configuración (incluye las
// cotizaciones, que cambian con las monedas configuradas). Nunca
// queryClient.clear() global acá.
export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationSettingsInput) => updateOrganizationSettings(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.settings() });
    },
  });
}

// El PUT devuelve los mensajes ya guardados (con el último cambio): se
// escriben en la cache sin otra ida.
export function useGuardarMensajesDeSalud() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MensajesDeSaludInput) => guardarMensajesDeSalud(input),
    onSuccess: (guardados) => {
      queryClient.setQueryData(organizationKeys.mensajesDeSalud(), guardados);
    },
  });
}
