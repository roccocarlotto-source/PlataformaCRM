import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";

// ---------------------------------------------------------------------------
// Bloqueos y sobreturnos de un profesional de clínica (docs/rubros.md §4.4 y
// §4.5, R6). Contrato de src/clinicas/controllers/agendaClinica.controller.ts.
// ---------------------------------------------------------------------------

export interface Bloqueo {
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
}

export interface TurnoAfectado {
  bookingId: string;
  startsAt: string;
  endsAt: string;
  isOverbooking: boolean;
  paciente: { id: string; nombre: string };
  prestacion: { id: string; name: string };
  tareaId: string;
}

export interface BloqueoCreado {
  bloqueo: Bloqueo;
  turnosAfectados: TurnoAfectado[];
}

export interface HorarioDeClinica {
  startsAt: string;
  endsAt: string;
  availableSeats: number;
  resource: { id: string; name: string };
  overbooking?: true;
}

export function listarBloqueos(
  resourceId: string,
  rango: { from: string; to: string },
  signal?: AbortSignal,
): Promise<{ bloqueos: Bloqueo[] }> {
  const params = new URLSearchParams(rango);
  return request(`/clinica/profesionales/${resourceId}/bloqueos?${params.toString()}`, {
    getAccessToken,
    signal,
  });
}

export function crearBloqueo(
  resourceId: string,
  body: { startsAt: string; endsAt: string; reason?: string },
): Promise<BloqueoCreado> {
  return request(`/clinica/profesionales/${resourceId}/bloqueos`, {
    method: "POST",
    body,
    getAccessToken,
  });
}

export function borrarBloqueo(id: string): Promise<void> {
  return request(`/clinica/bloqueos/${id}`, { method: "DELETE", getAccessToken });
}

export function configurarSobreturnos(
  resourceId: string,
  body: { allowsOverbooking: boolean; maxOverbookingsPerDay: number },
): Promise<{ id: string; allowsOverbooking: boolean; maxOverbookingsPerDay: number }> {
  return request(`/clinica/profesionales/${resourceId}/sobreturnos`, {
    method: "PUT",
    body,
    getAccessToken,
  });
}

export function horariosConSobreturnos(
  query: { serviceTypeId: string; resourceId: string; from: string; to: string },
  signal?: AbortSignal,
): Promise<{ availability: HorarioDeClinica[] }> {
  const params = new URLSearchParams({ ...query, sobreturnos: "true" });
  return request(`/clinica/disponibilidad?${params.toString()}`, { getAccessToken, signal });
}

export function crearSobreturno(body: {
  serviceTypeId: string;
  resourceId: string;
  contactId: string;
  startsAt: string;
}): Promise<{ id: string }> {
  return request("/clinica/turnos", {
    method: "POST",
    body: { ...body, isOverbooking: true },
    getAccessToken,
  });
}
