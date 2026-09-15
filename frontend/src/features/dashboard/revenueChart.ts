import { MONTHS } from "../activity/taskBuckets";

// ---------------------------------------------------------------------------
// Geometría del gráfico "Ingresos ganados por mes" (§30 y §32 de docs/
// frontend-cambios-pendientes.md). Sin librería de gráficos: una curva suave
// sobre 6 puntos escalada al máximo de la serie, y estas funciones puras son
// lo que hay que probar (revenueChart.test.ts); RevenueByMonthChart.tsx solo
// las dibuja.
//
// El ANCHO no es fijo (§32): lo mide el componente con un ResizeObserver y
// lo pasa como argumento. Antes había un viewBox de 600 que el CSS estiraba
// al ancho de la tarjeta, y como main no tiene max-width (global.css), en un
// monitor ancho todo lo que vive dentro del sistema de coordenadas del
// viewBox —incluidos font-size y stroke-width— escalaba con él. Con el ancho
// real, 1 unidad de viewBox es siempre 1px.
// ---------------------------------------------------------------------------

// Alto y márgenes fijos, en píxeles. El margen izquierdo aloja el rótulo del
// máximo ("3000.00 USD" a 11px), el de arriba deja lugar al tooltip del punto
// más alto, el de abajo a los rótulos de mes.
export const CHART_BOX = {
  height: 240,
  left: 88,
  right: 24,
  top: 40,
  bottom: 36,
} as const;

export interface ChartPoint {
  x: number;
  y: number;
  // "mar" — misma abreviatura que "Mis tareas" (MONTHS de taskBuckets.ts).
  label: string;
  value: number;
}

// Un tramo de la curva: cúbica de Bézier de `from` a `to`.
export interface CurveSegment {
  from: ChartPoint;
  to: ChartPoint;
  c1: { x: number; y: number };
  c2: { x: number; y: number };
}

export const CHART_BASELINE = CHART_BOX.height - CHART_BOX.bottom;

// "YYYY-MM" → "mar". El backend manda el mes calendario UTC como texto; no
// se pasa por Date para no arrastrar la zona horaria del navegador.
export function monthShortLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTHS[index] ?? month;
}

// Los puntos en coordenadas del viewBox para un ancho dado. El eje Y va de 0
// (abajo) al máximo de la serie (arriba); si todo es 0, todos los puntos
// quedan sobre la base. Un solo punto se centra; con más, se reparten en el
// ancho útil.
export function toChartPoints(
  series: ReadonlyArray<{ month: string; value: string }>,
  width: number,
): ChartPoint[] {
  const values = series.map((entry) => Number(entry.value));
  const max = Math.max(0, ...values);
  const innerWidth = width - CHART_BOX.left - CHART_BOX.right;
  const innerHeight = CHART_BOX.height - CHART_BOX.top - CHART_BOX.bottom;

  return series.map((entry, index) => {
    const value = values[index];
    const x =
      series.length === 1
        ? CHART_BOX.left + innerWidth / 2
        : CHART_BOX.left + (innerWidth * index) / (series.length - 1);
    const y = max === 0 ? CHART_BASELINE : CHART_BASELINE - (value / max) * innerHeight;
    return { x, y, label: monthShortLabel(entry.month), value };
  });
}

// Catmull-Rom → Bézier: cada tramo Pi→Pi+1 usa a sus vecinos Pi-1 y Pi+2 para
// los puntos de control (en los extremos, el vecino faltante es el propio
// extremo). La curva pasa exactamente por cada punto.
//
// Las Y de los puntos de control se acotan al rango de la serie: una cúbica
// nunca sale de la envolvente convexa de sus cuatro puntos, así que la curva
// no baja de la base cuando un mes en 0 queda entre dos con ingresos (sin la
// cota, Catmull-Rom dibuja ahí un "ingreso negativo" que no existe).
export function smoothSegments(points: ReadonlyArray<ChartPoint>): CurveSegment[] {
  if (points.length < 2) return [];
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const clampY = (y: number) => Math.min(maxY, Math.max(minY, y));

  return points.slice(0, -1).map((from, index) => {
    const previous = points[index - 1] ?? from;
    const to = points[index + 1];
    const next = points[index + 2] ?? to;
    return {
      from,
      to,
      c1: { x: from.x + (to.x - previous.x) / 6, y: clampY(from.y + (to.y - previous.y) / 6) },
      c2: { x: to.x - (next.x - from.x) / 6, y: clampY(to.y - (next.y - from.y) / 6) },
    };
  });
}

const coordinate = ({ x, y }: { x: number; y: number }) => `${x.toFixed(1)},${y.toFixed(1)}`;

// `d` de una sucesión de tramos contiguos: "M x,y C c1 c2 x,y C ...". Sirve
// tanto para la curva completa como para un subconjunto (el componente dibuja
// el último tramo aparte, punteado, porque el mes en curso no cerró).
export function segmentsToPath(segments: ReadonlyArray<CurveSegment>): string {
  if (segments.length === 0) return "";
  const curves = segments.map(
    (segment) => `C${coordinate(segment.c1)} ${coordinate(segment.c2)} ${coordinate(segment.to)}`,
  );
  return [`M${coordinate(segments[0].from)}`, ...curves].join(" ");
}

export function toSmoothPath(points: ReadonlyArray<ChartPoint>): string {
  if (points.length === 1) return `M${coordinate(points[0])}`;
  return segmentsToPath(smoothSegments(points));
}

// La misma curva cerrada contra la base, para el relleno en degradé.
export function toAreaPath(points: ReadonlyArray<ChartPoint>, baseline = CHART_BASELINE): string {
  if (points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  const base = baseline.toFixed(1);
  return `${toSmoothPath(points)} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`;
}

// Tooltip visual de un punto (rect + text, CSS lo muestra al hover). Sin
// medir texto: el ancho se estima por cantidad de caracteres a 11px, con
// aire. Se corre hacia adentro cuando el punto está cerca de un borde para
// no salirse del <svg>, y va arriba del punto (CHART_BOX.top le deja lugar
// al más alto).
export const TOOLTIP_BOX = {
  height: 22,
  charWidth: 6.6,
  paddingX: 10,
  gap: 12,
  edge: 4,
} as const;

export interface TooltipLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
}

export function tooltipLayout(point: ChartPoint, text: string, chartWidth: number): TooltipLayout {
  const width = Math.round(text.length * TOOLTIP_BOX.charWidth + TOOLTIP_BOX.paddingX * 2);
  const maxX = Math.max(TOOLTIP_BOX.edge, chartWidth - width - TOOLTIP_BOX.edge);
  const x = Math.min(maxX, Math.max(TOOLTIP_BOX.edge, point.x - width / 2));
  const y = point.y - TOOLTIP_BOX.gap - TOOLTIP_BOX.height;
  return {
    x,
    y,
    width,
    height: TOOLTIP_BOX.height,
    textX: x + width / 2,
    // Centro vertical del rect, con el ajuste de línea base de un texto de 11px.
    textY: y + TOOLTIP_BOX.height / 2 + 4,
  };
}

// Franja de hover de cada punto: la mitad de la distancia al vecino a cada
// lado, así se puede apuntar a una columna entera y no solo al círculo.
export function hitBand(
  points: ReadonlyArray<ChartPoint>,
  index: number,
  chartWidth: number,
): { x: number; width: number } {
  if (points.length < 2) return { x: 0, width: chartWidth };
  const step = points[1].x - points[0].x;
  const left = index === 0 ? 0 : points[index].x - step / 2;
  const right = index === points.length - 1 ? chartWidth : points[index].x + step / 2;
  return { x: left, width: right - left };
}
