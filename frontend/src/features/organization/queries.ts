import { useQuery } from "@tanstack/react-query";
import { getMetaConnection, getOrganizationSettings } from "./api";

// Una sola clave: la configuración es un singleton por organización (no hay
// lista ni detail por id). Sin namespacing por organizationId, por el mismo
// motivo que companyKeys: la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const organizationKeys = {
  all: ["organization"] as const,
  settings: () => [...organizationKeys.all, "settings"] as const,
  metaConnection: () => [...organizationKeys.all, "meta-connection"] as const,
};

// La consumen dos pantallas con necesidades distintas: la página de
// configuración (lee y edita) y la ficha de vehículo (solo necesita la
// cotización vigente para sugerir el precio en la otra moneda). Un solo hook,
// una sola clave, para que compartan la misma entrada de cache.
export function useOrganizationSettings() {
  return useQuery({
    queryKey: organizationKeys.settings(),
    queryFn: ({ signal }) => getOrganizationSettings(signal),
  });
}

// El estado de la conexión con la página de Facebook (ítem 173). null = nunca
// se conectó (ver getMetaConnection). A diferencia de Google Calendar no hace
// falta refetch al volver el foco: la conexión se completa navegando esta
// misma pestaña, que al volver carga la pantalla de cero.
export function useMetaConnection() {
  return useQuery({
    queryKey: organizationKeys.metaConnection(),
    queryFn: ({ signal }) => getMetaConnection(signal),
  });
}
