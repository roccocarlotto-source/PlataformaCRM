import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  completeMetaConnection,
  disconnectMetaConnection,
  startMetaConnection,
  updateOrganizationSettings,
} from "./api";
import { organizationKeys } from "./queries";
import type { MetaConnectionPendiente, UpdateOrganizationSettingsInput } from "./types";

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

// Iniciar la conexión con Facebook no cambia nada todavía (solo firma el state
// y devuelve la URL de Meta): no hay nada que invalidar. El cambio real
// ocurre al volver, en useCompleteMetaConnection.
export function useStartMetaConnection() {
  return useMutation({
    mutationFn: () => startMetaConnection(),
  });
}

export function useCompleteMetaConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pendiente: MetaConnectionPendiente) => completeMetaConnection(pendiente),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.metaConnection() });
    },
  });
}

export function useDisconnectMetaConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectMetaConnection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.metaConnection() });
    },
  });
}
