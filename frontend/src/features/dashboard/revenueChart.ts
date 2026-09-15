import { MONTHS } from "../activity/taskBuckets";

// ---------------------------------------------------------------------------
// Geometría del gráfico "Ingresos ganados por mes" (§30 de docs/frontend-
// cambios-pendientes.md). Sin librería de gráficos: es una polilínea sobre 6
// puntos escalada al máximo de la serie, y estas funciones puras son lo que
// hay que probar (revenueChart.test.ts); RevenueByMonthChart.tsx solo las
// dibuja.
// ---------------------------------------------------------------------------

// Caja fija del viewBox: el SVG escala al ancho de la tarjeta con
// preserveAspectRatio, así que las coordenadas son estables y testeables.
export const CHART_BOX = {
  width: 600,
  height: 200,
  // Margen para los rótulos: meses abajo, máximo a la izquierda.
  left: 56,
  right: 16,
  top: 16,
  bottom: 28,
} as const;

export interface ChartPoint {
  x: number;
  y: number;
  // "mar" — misma abreviatura que "Mis tareas" (MONTHS de taskBuckets.ts).
  label: string;
  value: number;
}

// "YYYY-MM" → "mar". El backend manda el mes calendario UTC como texto; no
// se pasa por Date para no arrastrar la zona horaria del navegador.
export function monthShortLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTHS[index] ?? month;
}

// Los puntos en coordenadas del viewBox. El eje Y va de 0 (abajo) al máximo
// de la serie (arriba); si todo es 0, todos los puntos quedan sobre la base.
// Un solo punto se centra; con más, se reparten en el ancho útil.
export function toChartPoints(
  series: ReadonlyArray<{ month: string; value: string }>,
): ChartPoint[] {
  const values = series.map((entry) => Number(entry.value));
  const max = Math.max(0, ...values);
  const innerWidth = CHART_BOX.width - CHART_BOX.left - CHART_BOX.right;
  const innerHeight = CHART_BOX.height - CHART_BOX.top - CHART_BOX.bottom;
  const baseline = CHART_BOX.top + innerHeight;

  return series.map((entry, index) => {
    const value = values[index];
    const x =
      series.length === 1
        ? CHART_BOX.left + innerWidth / 2
        : CHART_BOX.left + (innerWidth * index) / (series.length - 1);
    const y = max === 0 ? baseline : baseline - (value / max) * innerHeight;
    return { x, y, label: monthShortLabel(entry.month), value };
  });
}

export function toPolylinePoints(points: ReadonlyArray<ChartPoint>): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}
