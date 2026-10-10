import type { ConversationChannel } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  contarAvisosSinRespuesta,
  contarConsultasEsperandoRespuesta,
  contarDerivaciones,
  contarSeguimientosAgendados,
  contarTareasVencidas,
  conversacionesNuevasPorCanal,
} from "../repositories/dashboardAtencion.repository";
import { findOrganizationById } from "../repositories/organization.repository";
import { periodWindowInZone, type PeriodUnit } from "../utils/zonedWindow";

// ---------------------------------------------------------------------------
// Dashboard de atención (docs/ediciones.md §6.4; paso F de §10): lo que una
// organización sin el dashboard comercial (ESENCIAL) mira en el inicio.
// Conversaciones, derivaciones, consultas pendientes y tareas vencidas, en el
// período en curso calculado en la zona de la organización (zonedWindow,
// T-01), igual que el dashboard comercial. Sin oportunidades ni montos.
// ---------------------------------------------------------------------------

const CANALES: readonly ConversationChannel[] = ["WHATSAPP", "WEB", "INSTAGRAM", "MESSENGER"];

export interface DashboardDeAtencion {
  periodo: { label: string; start: string; end: string };
  conversacionesNuevas: { total: number; porCanal: Record<ConversationChannel, number> };
  derivaciones: number;
  derivacionesSinRespuesta: number;
  consultasPendientes: { esperandoRespuesta: number; seguimientosAgendados: number };
  tareasVencidas: number;
}

export async function getDashboardDeAtencion(
  organizationId: string,
  { granularity, now = new Date(), db = prisma }: { granularity: PeriodUnit; now?: Date; db?: Db },
): Promise<DashboardDeAtencion> {
  const organization = await findOrganizationById(organizationId, db);
  const ventana = periodWindowInZone(granularity, now, organization?.timezone ?? "UTC", 0);

  const [porCanal, derivaciones, sinRespuesta, esperando, agendados, vencidas] = await Promise.all([
    conversacionesNuevasPorCanal(organizationId, ventana, db),
    contarDerivaciones(organizationId, ventana, db),
    contarAvisosSinRespuesta(organizationId, ventana, db),
    contarConsultasEsperandoRespuesta(organizationId, db),
    contarSeguimientosAgendados(organizationId, db),
    contarTareasVencidas(organizationId, now, db),
  ]);

  const conteo = Object.fromEntries(CANALES.map((canal) => [canal, 0])) as Record<
    ConversationChannel,
    number
  >;
  for (const fila of porCanal) conteo[fila.channel] = fila.count;

  return {
    periodo: {
      label: ventana.label,
      start: ventana.start.toISOString(),
      end: ventana.end.toISOString(),
    },
    conversacionesNuevas: {
      total: porCanal.reduce((n, fila) => n + fila.count, 0),
      porCanal: conteo,
    },
    derivaciones,
    derivacionesSinRespuesta: sinRespuesta,
    consultasPendientes: { esperandoRespuesta: esperando, seguimientosAgendados: agendados },
    tareasVencidas: vencidas,
  };
}
