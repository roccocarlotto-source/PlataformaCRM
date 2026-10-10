import { useQuery } from "@tanstack/react-query";
import { Card } from "../../design-system/Card";
import { Skeleton } from "../../design-system/Skeleton";
import type { OpportunityRevenueGranularity } from "../opportunity/types";
import {
  dashboardDeAtencionKey,
  detalleDeCanales,
  getDashboardDeAtencion,
  type DashboardDeAtencion,
} from "./atencion";

// ---------------------------------------------------------------------------
// Dashboard de atención (docs/ediciones.md §6.4): las tarjetas que reemplazan
// a las comerciales en una organización sin el dashboard comercial
// (ESENCIAL). Mismo esqueleto que OpportunityKpiCards (.ds-kpi-row), sin
// montos ni variación: conversaciones, derivaciones, consultas y tareas.
// ---------------------------------------------------------------------------

interface Tarjeta {
  key: string;
  label: string;
  valor: (d: DashboardDeAtencion) => number;
  detalle?: (d: DashboardDeAtencion) => string;
}

const TARJETAS: Tarjeta[] = [
  {
    key: "conversaciones",
    label: "Conversaciones nuevas",
    valor: (d) => d.conversacionesNuevas.total,
    detalle: (d) => detalleDeCanales(d.conversacionesNuevas.porCanal),
  },
  { key: "derivaciones", label: "Derivadas a una persona", valor: (d) => d.derivaciones },
  {
    key: "sin-respuesta",
    label: "Sin respuesta a tiempo",
    valor: (d) => d.derivacionesSinRespuesta,
  },
  {
    key: "esperando",
    label: "Consultas esperando respuesta",
    valor: (d) => d.consultasPendientes.esperandoRespuesta,
  },
  {
    key: "seguimientos",
    label: "Seguimientos agendados",
    valor: (d) => d.consultasPendientes.seguimientosAgendados,
  },
  { key: "tareas", label: "Tareas vencidas", valor: (d) => d.tareasVencidas },
];

export function AtencionKpiCards({ granularity }: { granularity: OpportunityRevenueGranularity }) {
  const query = useQuery({
    queryKey: dashboardDeAtencionKey(granularity),
    queryFn: ({ signal }) => getDashboardDeAtencion(granularity, signal),
  });

  return (
    <section aria-label="Resumen de atención">
      <dl className="ds-card-grid ds-kpi-row">
        {TARJETAS.map((tarjeta) => (
          <Card as="div" key={tarjeta.key} className="ds-kpi">
            <dt className="ds-kpi-label">{tarjeta.label}</dt>
            {query.isLoading ? (
              <dd className="ds-kpi-state">
                <Skeleton width="55%" height="1.75rem" />
                <span className="ds-sr-only">Cargando…</span>
              </dd>
            ) : null}
            {query.isError ? (
              <dd className="ds-kpi-state" role="alert">
                No pudimos cargar este dato
                {query.error instanceof Error ? `: ${query.error.message}` : "."}
              </dd>
            ) : null}
            {query.data ? (
              <>
                <dd className="ds-kpi-value">{tarjeta.valor(query.data)}</dd>
                {tarjeta.detalle ? (
                  <dd className="ds-kpi-delta">{tarjeta.detalle(query.data)}</dd>
                ) : null}
              </>
            ) : null}
          </Card>
        ))}
      </dl>
    </section>
  );
}
