import { useQuery } from "@tanstack/react-query";
import { getOrganizationMetaConnection, listOrganizations } from "./api";

// Las lecturas de las pantallas de plataforma. Con namespace propio: los datos
// son de OTRAS organizaciones y no se mezclan con las claves de la propia.
export const platformAdminKeys = {
  all: ["platform-admin"] as const,
  organizations: () => [...platformAdminKeys.all, "organizations"] as const,
  metaConnection: (organizationId: string) =>
    [...platformAdminKeys.all, "meta-connection", organizationId] as const,
};

export function usePlatformOrganizations() {
  return useQuery({
    queryKey: platformAdminKeys.organizations(),
    queryFn: ({ signal }) => listOrganizations(signal),
  });
}

// null = la organización nunca se conectó. Sin organización elegida no consulta.
export function useOrganizationMetaConnection(organizationId: string) {
  return useQuery({
    queryKey: platformAdminKeys.metaConnection(organizationId),
    queryFn: ({ signal }) => getOrganizationMetaConnection(organizationId, signal),
    enabled: organizationId !== "",
  });
}
