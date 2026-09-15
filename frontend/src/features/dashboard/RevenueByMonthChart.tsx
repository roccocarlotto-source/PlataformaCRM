import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
  nearestPointIndex,
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
// Las animaciones de entrada viven en design-system.css (.ds-chart-*), sin
// JS: el <svg> no lleva ninguna key atada a los datos, así que un refetch en
// background reconcilia los mismos nodos y no las repite.
//
// El hover SÍ pasa por JS desde el §33: un único <rect> de captura sobre
// todo el área útil y un solo crosshair que se posiciona en el punto más
// cercano al puntero (ver Crosshair). Antes cada punto tenía su propia
// franja de :hover y su propio tooltip, y el resultado saltaba de columna en
// columna.
//
// Una sola serie, así que no lleva leyenda: el título ya la nombra. El
// <title> de cada punto es el nombre accesible del círculo, y la tabla
// oculta es la versión legible por lector de pantalla; el crosshair es un
// duplicado decorativo de esos <title>.
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

// Estado del crosshair: el índice se conserva al salir del gráfico para que
// el grupo se desvanezca DONDE estaba y no salte al punto 0 mientras se va.
interface CrosshairState {
  index: number;
  visible: boolean;
}

function ChartSvg({ series, width, max, currency }: ChartSvgProps) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [crosshair, setCrosshair] = useState<CrosshairState>({ index: 0, visible: false });
  const points = toChartPoints(series, width);
  const segments = smoothSegments(points);
  // El último tramo va aparte y punteado: es el mes en curso, sin cerrar.
  const solidPath = segmentsToPath(segments.slice(0, -1));
  const partialPath = segmentsToPath(segments.slice(-1));
  const areaPath = toAreaPath(points);
  const right = width - CHART_BOX.right;
  const pointText = (point: ChartPoint) =>
    `${point.label}: ${formatAmount(String(point.value), currency)}`;

  // El <rect> de captura y el <svg> comparten el sistema de coordenadas (el
  // viewBox es 1:1 con el ancho renderizado desde el §32), así que restarle
  // el borde izquierdo del <svg> al clientX ya da la X del viewBox.
  function handlePointerMove(event: PointerEvent<SVGRectElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const index = nearestPointIndex(points, event.clientX - box.left);
    setCrosshair((current) =>
      current.visible && current.index === index ? current : { index, visible: true },
    );
  }

  function handlePointerLeave() {
    setCrosshair((current) => (current.visible ? { ...current, visible: false } : current));
  }

  // La serie puede acortarse entre renders (otra respuesta del backend): el
  // índice guardado se acota acá y nunca se lee un punto que no existe.
  const activePoint = points[Math.min(crosshair.index, points.length - 1)];

  return (
    <svg
      ref={svgRef}
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

      {/* Los círculos de cada punto: el <title> es su nombre accesible y el
          índice escalona la animación de entrada. */}
      {points.map((point, index) => (
        <circle
          key={point.label}
          className="ds-chart-point"
          style={{ "--ds-chart-index": index } as CSSProperties}
          cx={point.x}
          cy={point.y}
          r={4}
        >
          <title>{pointText(point)}</title>
        </circle>
      ))}

      {activePoint ? (
        <Crosshair
          point={activePoint}
          visible={crosshair.visible}
          text={pointText(activePoint)}
          width={width}
        />
      ) : null}

      {/* Último, para quedar encima de todo: es el único elemento que recibe
          eventos de puntero, así el crosshair no parpadea al pasar por arriba
          de un círculo (que, siendo hermano y no descendiente, dispararía el
          pointerleave de este rect). */}
      <rect
        className="ds-chart-hit"
        x={CHART_BOX.left}
        y={0}
        width={Math.max(0, right - CHART_BOX.left)}
        height={CHART_BOX.height}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      />
    </svg>
  );
}

interface CrosshairProps {
  point: ChartPoint;
  visible: boolean;
  text: string;
  width: number;
}

// Crosshair único que sigue al puntero (§33): guía vertical, círculo
// resaltado y tooltip, todos dibujados en coordenadas RELATIVAS al punto
// activo y llevados a su lugar con dos `transform` anidados —
// translateX(point.x) afuera, translateY(point.y) adentro. Es lo que permite
// que el movimiento entre puntos sea un deslizamiento: la transición CSS
// interpola el transform, cosa que no podría hacer con atributos x/cx.
//
// El tooltip va en el grupo interno porque su desplazamiento vertical
// respecto del punto es constante (siempre arriba del círculo); el
// horizontal no lo es —tooltipLayout lo corre hacia adentro cerca de los
// bordes— así que se usa la diferencia contra la X del punto, que ya
// contempla ese corrimiento.
function Crosshair({ point, visible, text, width }: CrosshairProps) {
  const tooltip = tooltipLayout(point, text, width);

  return (
    <g
      className={`ds-chart-crosshair${visible ? " is-visible" : ""}`}
      aria-hidden="true"
      style={{ transform: `translateX(${point.x}px)` }}
    >
      <line className="ds-chart-guide" x1={0} x2={0} y1={CHART_BOX.top} y2={CHART_BASELINE} />
      <g className="ds-chart-crosshair-focus" style={{ transform: `translateY(${point.y}px)` }}>
        <circle className="ds-chart-crosshair-point" cx={0} cy={0} r={6} />
        <rect
          className="ds-chart-tooltip-box"
          x={tooltip.x - point.x}
          y={tooltip.y - point.y}
          width={tooltip.width}
          height={tooltip.height}
          rx={6}
        />
        <text
          className="ds-chart-tooltip-text"
          x={tooltip.textX - point.x}
          y={tooltip.textY - point.y}
          textAnchor="middle"
        >
          {text}
        </text>
      </g>
    </g>
  );
}
