import { useQuery } from "@tanstack/react-query";
import {
  getEstadoDelReinicioDeLaDemo,
  getInformeDePreguntas,
  getEstadoDelTokenDeWhatsapp,
  getLlmUsage,
  getOrganizationMetaConnection,
  listAgentesDeOrganizacion,
  listEditions,
  listIndustries,
  listOrganizations,
  getWabaDeLaClinica,
} from "./api";
import type { FiltrosDelInforme } from "./types";

// Las lecturas de las pantallas de plataforma. Con namespace propio: los datos
// son de OTRAS organizaciones y no se mezclan con las claves de la propia.
export const platformAdminKeys = {
  all: ["platform-admin"] as const,
  organizations: () => [...platformAdminKeys.all, "organizations"] as const,
  metaConnection: (organizationId: string) =>
    [...platformAdminKeys.all, "meta-connection", organizationId] as const,
  agentesDeOrganizaciones: () => [...platformAdminKeys.all, "organization-agents"] as const,
  agentesDeOrganizacion: (organizationId: string) =>
    [...platformAdminKeys.agentesDeOrganizaciones(), organizationId] as const,
  llmUsage: () => [...platformAdminKeys.all, "llm-usage"] as const,
  whatsappToken: () => [...platformAdminKeys.all, "whatsapp-token"] as const,
  informeDePreguntas: (filtros: FiltrosDelInforme) =>
    [...platformAdminKeys.all, "help-assistant-questions", filtros] as const,
  editions: () => [...platformAdminKeys.all, "editions"] as const,
  industries: () => [...platformAdminKeys.all, "industries"] as const,
  wabaDeLaClinica: (organizationId: string) =>
    [...platformAdminKeys.all, "waba", organizationId] as const,
  reinicioDeLaDemo: (organizationId: string) =>
    [...platformAdminKeys.all, "reinicio-de-demo", organizationId] as const,
};

// Cada cuánto se vuelve a preguntar mientras una demo se está reiniciando. El
// GET pasa por el rate limiter de escrituras (100 por minuto por usuario).
export const INTERVALO_DEL_REINICIO_MS = 3000;

// En qué quedó el reinicio de una demo (corre en segundo plano). Mientras está
// REINICIANDO, se vuelve a pedir cada INTERVALO_DEL_REINICIO_MS.
export function useEstadoDelReinicioDeLaDemo(organizationId: string) {
  return useQuery({
    queryKey: platformAdminKeys.reinicioDeLaDemo(organizationId),
    queryFn: ({ signal }) => getEstadoDelReinicioDeLaDemo(organizationId, signal),
    refetchInterval: (query) =>
      query.state.data?.estado === "REINICIANDO" ? INTERVALO_DEL_REINICIO_MS : false,
  });
}

// Los rubros que se pueden elegir al dar de alta una organización.
export function useRubrosDisponibles() {
  return useQuery({
    queryKey: platformAdminKeys.industries(),
    queryFn: ({ signal }) => listIndustries(signal),
  });
}

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

// OPS-03: el estado del token global de WhatsApp.
export function useEstadoDelTokenDeWhatsapp() {
  return useQuery({
    queryKey: platformAdminKeys.whatsappToken(),
    queryFn: ({ signal }) => getEstadoDelTokenDeWhatsapp(signal),
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

// Los agentes de la organización elegida, para el selector de "Modelo de IA".
// Sin organización elegida no consulta.
export function usePlatformAgentesDeOrganizacion(organizationId: string) {
  return useQuery({
    queryKey: platformAdminKeys.agentesDeOrganizacion(organizationId),
    queryFn: ({ signal }) => listAgentesDeOrganizacion(organizationId, signal),
    enabled: organizationId !== "",
  });
}

// El WABA propio de la clínica elegida (docs/whatsapp-alta-clinica.md). Sin
// organización elegida no consulta.
export function useWabaDeLaClinica(organizationId: string) {
  return useQuery({
    queryKey: platformAdminKeys.wabaDeLaClinica(organizationId),
    queryFn: ({ signal }) => getWabaDeLaClinica(organizationId, signal),
    enabled: organizationId !== "",
  });
}

// "Preguntas a la ayuda", con sus filtros en la clave: cambiar uno es otra
// consulta, y volver al anterior sale del caché.
export function useInformeDePreguntas(filtros: FiltrosDelInforme) {
  return useQuery({
    queryKey: platformAdminKeys.informeDePreguntas(filtros),
    queryFn: ({ signal }) => getInformeDePreguntas(filtros, signal),
  });
}
