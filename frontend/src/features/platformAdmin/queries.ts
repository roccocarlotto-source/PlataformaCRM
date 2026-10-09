import { useQuery } from "@tanstack/react-query";
import {
  getLlmUsage,
  getOrganizationMetaConnection,
  listEditions,
  listIndustries,
  listOrganizations,
} from "./api";

// Las lecturas de las pantallas de plataforma. Con namespace propio: los datos
// son de OTRAS organizaciones y no se mezclan con las claves de la propia.
export const platformAdminKeys = {
  all: ["platform-admin"] as const,
  organizations: () => [...platformAdminKeys.all, "organizations"] as const,
  metaConnection: (organizationId: string) =>
    [...platformAdminKeys.all, "meta-connection", organizationId] as const,
  llmUsage: () => [...platformAdminKeys.all, "llm-usage"] as const,
  editions: () => [...platformAdminKeys.all, "editions"] as const,
  industries: () => [...platformAdminKeys.all, "industries"] as const,
};

// Los rubros que se pueden elegir al dar de alta una organización.
export function useRubrosDisponibles() {
  return useQuery({
    queryKey: platformAdminKeys.industries(),
    queryFn: ({ signal }) => listIndustries(signal),
  });
}

// Las ediciones que se pueden elegir al dar de alta una organización.
export function useEdicionesDisponibles() {
  return useQuery({
    queryKey: platformAdminKeys.editions(),
    queryFn: ({ signal }) => listEditions(signal),
  });
}

// B4: el gasto en el modelo por organización de los últimos 30 días.
export function useLlmUsage() {
  return useQuery({
    queryKey: platformAdminKeys.llmUsage(),
    queryFn: ({ signal }) => getLlmUsage(signal),
  });
}

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
