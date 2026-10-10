import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";
import type { PrestacionesResponse, ProfesionalesResponse } from "./types";

// La agenda de clínica (docs/rubros.md §4.3). organizationId nunca viaja acá.

export function listPrestaciones(signal?: AbortSignal): Promise<PrestacionesResponse> {
  return request<PrestacionesResponse>("/clinica/prestaciones", { getAccessToken, signal });
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
