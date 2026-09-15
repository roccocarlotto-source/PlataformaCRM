import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatAmount } from "../opportunity/format";
import { useDashboardSummary } from "./queries";
import { CHART_BOX, toChartPoints, toPolylinePoints } from "./revenueChart";

// Reemplazo del "Pipeline overview" del mockup (§30 de docs/frontend-cambios-
// pendientes.md): no hay historial de Opportunity para saber cuánto valía el
// pipeline en una fecha pasada, así que se grafica un dato que sí es real —
// SUM(amount) de las ganadas por mes de cierre, últimos 6 meses, en la
// moneda de la organización. Es la misma serie que el backend ya calcula
// para "Ganado este mes"; la card y el gráfico comparten el request.
//
// SVG a mano, sin librería (el frontend no tiene ninguna): una polilínea de
// 2px con un marcador por mes, escalada al máximo de la serie, rótulos de
// mes abajo y el máximo a la izquierda. Una sola serie, así que no lleva
// leyenda: el título ya la nombra. El <title> de cada marcador es el tooltip
// nativo, y la tabla oculta es la versión legible por lector de pantalla.
export function RevenueByMonthChart() {
  const summary = useDashboardSummary();
  const series = summary.data?.revenueByMonth ?? [];
  const currency = summary.data?.currency ?? "";
  const points = toChartPoints(series);
  const max = Math.max(0, ...points.map((point) => point.value));
  const baseline = CHART_BOX.height - CHART_BOX.bottom;

  return (
    <Card aria-label="Ingresos ganados por mes" heading="Ingresos ganados por mes">
      {summary.isLoading ? <LoadingState /> : null}

      {summary.isError ? (
        <ErrorState>
          No pudimos cargar los ingresos por mes
          {summary.error instanceof Error ? `: ${summary.error.message}` : "."}
        </ErrorState>
      ) : null}

      {summary.isSuccess && max === 0 ? (
        <EmptyState>Todavía no hay ingresos ganados en los últimos 6 meses.</EmptyState>
      ) : null}

      {summary.isSuccess && max > 0 ? (
        <>
          <svg
            className="ds-chart"
            viewBox={`0 0 ${CHART_BOX.width} ${CHART_BOX.height}`}
            role="img"
            aria-label={`Ingresos ganados por mes, últimos 6 meses, en ${currency}`}
          >
            {/* Base y techo: dos líneas de referencia, recesivas. */}
            <line
              className="ds-chart-grid"
              x1={CHART_BOX.left}
              x2={CHART_BOX.width - CHART_BOX.right}
              y1={baseline}
              y2={baseline}
            />
            <line
              className="ds-chart-grid"
              x1={CHART_BOX.left}
              x2={CHART_BOX.width - CHART_BOX.right}
              y1={CHART_BOX.top}
              y2={CHART_BOX.top}
            />
            <text
              className="ds-chart-label"
              x={CHART_BOX.left - 8}
              y={CHART_BOX.top + 4}
              textAnchor="end"
            >
              {formatAmount(String(max), currency)}
            </text>
            <text
              className="ds-chart-label"
              x={CHART_BOX.left - 8}
              y={baseline + 4}
              textAnchor="end"
            >
              0
            </text>
            <polyline className="ds-chart-line" points={toPolylinePoints(points)} />
            {points.map((point) => (
              <g key={point.label}>
                <circle className="ds-chart-point" cx={point.x} cy={point.y} r={4}>
                  <title>{`${point.label}: ${formatAmount(String(point.value), currency)}`}</title>
                </circle>
                <text
                  className="ds-chart-label"
                  x={point.x}
                  y={CHART_BOX.height - 8}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              </g>
            ))}
          </svg>
          <table className="ds-sr-only">
            <caption>Ingresos ganados por mes</caption>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {series.map((entry) => (
                <tr key={entry.month}>
                  <td>{entry.month}</td>
                  <td>{formatAmount(entry.value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Card>
  );
}
