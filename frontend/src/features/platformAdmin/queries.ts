import { useQuery } from "@tanstack/react-query";
import { getLlmUsage, getOrganizationMetaConnection, listEditions, listOrganizations } from "./api";

// Las lecturas de las pantallas de plataforma. Con namespace propio: los datos
// son de OTRAS organizaciones y no se mezclan con las claves de la propia.
export const platformAdminKeys = {
  all: ["platform-admin"] as const,
  organizations: () => [...platformAdminKeys.all, "organizations"] as const,
  metaConnection: (organizationId: string) =>
    [...platformAdminKeys.all, "meta-connection", organizationId] as const,
  llmUsage: () => [...platformAdminKeys.all, "llm-usage"] as const,
  editions: () => [...platformAdminKeys.all, "editions"] as const,
};

// Las ediciones que se pueden elegir al dar de alta una organización.
export function useEdicionesDisponibles(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: platformAdminKeys.editions(),
    queryFn: ({ signal }) => listEditions(signal),
    enabled: options.enabled ?? true,
  });
}

// Si el backend ya ofrece ESENCIAL (la llave ESENCIAL_HABILITADA de
// src/config/ediciones.ts). Mientras no, las pantallas de ediciones de
// Plataforma no se muestran: "Organizaciones" llega al menú recién cuando
// existe una organización que se pueda subir.
export function useEsencialOfrecida(options: { enabled?: boolean } = {}) {
  const query = useEdicionesDisponibles(options);
  return {
    ofrecida: (query.data?.editions ?? []).includes("ESENCIAL"),
    isLoading: query.isLoading,
  };
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
