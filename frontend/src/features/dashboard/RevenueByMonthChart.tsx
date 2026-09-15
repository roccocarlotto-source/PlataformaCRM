import { useId, type CSSProperties } from "react";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useContainerWidth } from "../../lib/useContainerWidth";
import { formatAmount } from "../opportunity/format";
import { useDashboardSummary } from "./queries";
import {
  CHART_BASELINE,
  CHART_BOX,
  hitBand,
  segmentsToPath,
  smoothSegments,
  toAreaPath,
  toChartPoints,
  tooltipLayout,
  type ChartPoint,
} from "./revenueChart";

// Reemplazo del "Pipeline overview" del mockup (§30 de docs/frontend-cambios-
// pendientes.md): no hay historial de Opportunity para saber cuánto valía el
// pipeline en una fecha pasada, así que se grafica un dato que sí es real —
// SUM(amount) de las ganadas por mes de cierre, últimos 6 meses, en la
// moneda de la organización. Es la misma serie que el backend ya calcula
// para "Ganado este mes"; la card y el gráfico comparten el request.
//
// SVG a mano, sin librería (el frontend no tiene ninguna). Desde el §32: el
// <svg> se dibuja con el ancho REAL de la tarjeta (useContainerWidth), y ese
// mismo número va al viewBox y a width/height — nunca un viewBox fijo que el
// CSS estira, porque entonces los rótulos escalaban con la tarjeta. Curva
// suave (Catmull-Rom → Bézier) con relleno en degradé, el último tramo
// punteado porque el backend manda el mes calendario en curso al final de la
// serie (lastMonthsUTC: "la actual al final") y ese dato todavía no cerró.
// Las animaciones de entrada y el hover por punto viven en design-system.css
// (.ds-chart-*), sin JS: el <svg> no lleva ninguna key atada a los datos, así
// que un refetch en background reconcilia los mismos nodos y no las repite.
//
// Una sola serie, así que no lleva leyenda: el título ya la nombra. El
// <title> de cada marcador es el tooltip nativo, y la tabla oculta es la
// versión legible por lector de pantalla; el tooltip visual del hover es un
// duplicado decorativo de ese <title>.
export function RevenueByMonthChart() {
  const summary = useDashboardSummary();
  const { ref, width } = useContainerWidth();
  const series = summary.data?.revenueByMonth ?? [];
  const currency = summary.data?.currency ?? "";
  const max = Math.max(0, ...series.map((entry) => Number(entry.value)));

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
        <div className="ds-chart-frame" ref={ref}>
          {/* Sin ancho medido todavía (el primer frame) no se dibuja nada:
              un ancho inventado es exactamente el bug que el §32 corrige. */}
          {width !== null && width > 0 ? (
            <ChartSvg series={series} width={width} max={max} currency={currency} />
          ) : null}
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
        </div>
      ) : null}
    </Card>
  );
}

interface ChartSvgProps {
  series: ReadonlyArray<{ month: string; value: string }>;
  width: number;
  max: number;
  currency: string;
}

function ChartSvg({ series, width, max, currency }: ChartSvgProps) {
  const gradientId = useId();
  const points = toChartPoints(series, width);
  const segments = smoothSegments(points);
  // El último tramo va aparte y punteado: es el mes en curso, sin cerrar.
  const solidPath = segmentsToPath(segments.slice(0, -1));
  const partialPath = segmentsToPath(segments.slice(-1));
  const areaPath = toAreaPath(points);
  const right = width - CHART_BOX.right;

  return (
    <svg
      className="ds-chart"
      width={width}
      height={CHART_BOX.height}
      viewBox={`0 0 ${width} ${CHART_BOX.height}`}
      role="img"
      aria-label={`Ingresos ganados por mes, últimos 6 meses, en ${currency}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop className="ds-chart-area-stop-start" offset="0" />
          <stop className="ds-chart-area-stop-end" offset="1" />
        </linearGradient>
      </defs>

      {/* Base y techo: dos líneas de referencia, recesivas. */}
      <line
        className="ds-chart-grid"
        x1={CHART_BOX.left}
        x2={right}
        y1={CHART_BASELINE}
        y2={CHART_BASELINE}
      />
      <line
        className="ds-chart-grid"
        x1={CHART_BOX.left}
        x2={right}
        y1={CHART_BOX.top}
        y2={CHART_BOX.top}
      />
      <text
        className="ds-chart-label"
        x={CHART_BOX.left - 10}
        y={CHART_BOX.top + 4}
        textAnchor="end"
      >
        {formatAmount(String(max), currency)}
      </text>
      <text
        className="ds-chart-label"
        x={CHART_BOX.left - 10}
        y={CHART_BASELINE + 4}
        textAnchor="end"
      >
        0
      </text>

      {areaPath ? (
        <path className="ds-chart-area" d={areaPath} fill={`url(#${gradientId})`} />
      ) : null}
      {/* pathLength=1 normaliza el largo para que el CSS dibuje la línea con
          stroke-dasharray/dashoffset sin medirla desde JS. */}
      {solidPath ? (
        <path className="ds-chart-line ds-chart-line--solid" d={solidPath} pathLength={1} />
      ) : null}
      {partialPath ? (
        <path className="ds-chart-line ds-chart-line--partial" d={partialPath} />
      ) : null}

      {points.map((point) => (
        <text
          key={point.label}
          className="ds-chart-label"
          x={point.x}
          y={CHART_BOX.height - 10}
          textAnchor="middle"
        >
          {point.label}
        </text>
      ))}

      {points.map((point, index) => (
        <ChartMarker
          key={point.label}
          point={point}
          index={index}
          band={hitBand(points, index, width)}
          width={width}
          text={`${point.label}: ${formatAmount(String(point.value), currency)}`}
        />
      ))}
    </svg>
  );
}

interface ChartMarkerProps {
  point: ChartPoint;
  index: number;
  band: { x: number; width: number };
  width: number;
  text: string;
}

// Marcador de un punto con su franja de hover: al pasar el mouse por la
// columna, el círculo crece, aparece una guía vertical punteada y el tooltip
// visual (rect + text). Todo por CSS (:hover sobre el <g>), sin seguir el
// mouse desde JS. El índice va como custom property para escalonar la
// entrada.
function ChartMarker({ point, index, band, width, text }: ChartMarkerProps) {
  const tooltip = tooltipLayout(point, text, width);
  const style = { "--ds-chart-index": index } as CSSProperties;

  return (
    <g className="ds-chart-marker" style={style}>
      <rect
        className="ds-chart-hit"
        x={band.x}
        y={0}
        width={band.width}
        height={CHART_BOX.height}
      />
      <line
        className="ds-chart-guide"
        x1={point.x}
        x2={point.x}
        y1={CHART_BOX.top}
        y2={CHART_BASELINE}
      />
      <circle className="ds-chart-point" cx={point.x} cy={point.y} r={4}>
        <title>{text}</title>
      </circle>
      <g className="ds-chart-tooltip" aria-hidden="true">
        <rect
          className="ds-chart-tooltip-box"
          x={tooltip.x}
          y={tooltip.y}
          width={tooltip.width}
          height={tooltip.height}
          rx={6}
        />
        <text
          className="ds-chart-tooltip-text"
          x={tooltip.textX}
          y={tooltip.textY}
          textAnchor="middle"
        >
          {text}
        </text>
      </g>
    </g>
  );
}
