import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type {
  CambiosDeConfiguracionDeSede,
  ConfiguracionDeSede,
  PrestacionesResponse,
  ProfesionalesResponse,
} from "./types";

// La agenda de clínica (docs/rubros.md §4.3). organizationId nunca viaja acá.

export function listPrestaciones(signal?: AbortSignal): Promise<PrestacionesResponse> {
  return request<PrestacionesResponse>("/clinica/prestaciones", { getAccessToken, signal });
}

// R11: la configuración de clínica de una sede (solo ADMIN).
export function getConfiguracionDeSede(
  branchId: string,
  signal?: AbortSignal,
): Promise<ConfiguracionDeSede> {
  return request<ConfiguracionDeSede>(`/clinica/sedes/${branchId}/configuracion`, {
    getAccessToken,
    signal,
  });
}

export function guardarConfiguracionDeSede(
  branchId: string,
  body: CambiosDeConfiguracionDeSede,
): Promise<ConfiguracionDeSede> {
  return request<ConfiguracionDeSede>(`/clinica/sedes/${branchId}/configuracion`, {
    method: "PUT",
    body,
    getAccessToken,
  });
}

export function definirProfesionales(
  serviceTypeId: string,
  resourceIds: string[],
): Promise<ProfesionalesResponse> {
  return request<ProfesionalesResponse>(`/clinica/prestaciones/${serviceTypeId}/profesionales`, {
    method: "PUT",
    body: { resourceIds },
    getAccessToken,
  });
}

// R14: "Recordar control a los N días" de una prestación (solo ADMIN).
export function configurarControl(
  serviceTypeId: string,
  followUpAfterDays: number | null,
): Promise<{ id: string; followUpAfterDays: number | null }> {
  return request(`/clinica/prestaciones/${serviceTypeId}/control`, {
    method: "PUT",
    body: { followUpAfterDays },
    getAccessToken,
  });
}
