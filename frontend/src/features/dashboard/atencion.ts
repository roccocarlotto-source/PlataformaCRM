import { getAccessToken } from "../../auth/getAccessToken";
import { request } from "../../lib/api";
import type { OpportunityRevenueGranularity } from "../opportunity/types";

// Contrato de GET /api/dashboard/atencion (docs/ediciones.md §6.4,
// src/services/dashboardAtencion.service.ts).
export interface DashboardDeAtencion {
  periodo: { label: string; start: string; end: string };
  conversacionesNuevas: {
    total: number;
    porCanal: Record<"WHATSAPP" | "WEB" | "INSTAGRAM" | "MESSENGER", number>;
  };
  derivaciones: number;
  derivacionesSinRespuesta: number;
  consultasPendientes: { esperandoRespuesta: number; seguimientosAgendados: number };
  tareasVencidas: number;
}

export function getDashboardDeAtencion(
  granularity: OpportunityRevenueGranularity,
  signal?: AbortSignal,
): Promise<DashboardDeAtencion> {
  return request<DashboardDeAtencion>(`/dashboard/atencion?granularity=${granularity}`, {
    getAccessToken,
    signal,
  });
}

export const dashboardDeAtencionKey = (granularity: OpportunityRevenueGranularity) =>
  ["dashboard", "atencion", granularity] as const;

const CANALES: {
  key: keyof DashboardDeAtencion["conversacionesNuevas"]["porCanal"];
  label: string;
}[] = [
  { key: "WHATSAPP", label: "WhatsApp" },
  { key: "WEB", label: "Web" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "MESSENGER", label: "Messenger" },
];

/** "WhatsApp 2 · Web 1": solo los canales con conversaciones. */
export function detalleDeCanales(
  porCanal: DashboardDeAtencion["conversacionesNuevas"]["porCanal"],
) {
  const partes = CANALES.filter((c) => porCanal[c.key] > 0).map(
    (c) => `${c.label} ${String(porCanal[c.key])}`,
  );
  return partes.length > 0 ? partes.join(" · ") : "Sin conversaciones nuevas";
}
