import { formatAmount } from "../opportunity/format";
import type {
  OpportunityDashboardSummary,
  OpportunityRevenueGranularity,
} from "../opportunity/types";

// ---------------------------------------------------------------------------
// Las cuatro cards del resumen comercial (§30 de docs/frontend-cambios-
// pendientes.md) a partir de los números crudos del backend. Lógica pura,
// sin React, probada sola (kpi.test.ts) — mismo espíritu que taskBuckets.ts.
//
// Cada card es rótulo + valor grande + una línea de variación. La variación
// tiene tres salidas: sube (verde), baja (rojo) o neutral (gris) — y neutral
// también cubre "no hay base de comparación", que se muestra como "—" en vez
// de inventar un porcentaje sobre un cero.
//
// Desde el §35 tres de las cuatro siguen al selector de período: "creadas",
// "ganado" y "tasa de cierre" cambian de rótulo, de comparación Y de números
// según la granularidad, que sale del propio resumen (`summary.granularity`,
// el eco del backend) y no del estado de la página — así el rótulo nunca
// describe una ventana distinta de la de los números que acompaña.
//
// "Valor del pipeline" es la excepción y es el punto del ítem: es la foto de
// lo que está abierto AHORA, y su variación se compara siempre contra el mes
// anterior, elija lo que elija el selector.
// ---------------------------------------------------------------------------

export type KpiDeltaDirection = "up" | "down" | "neutral";

export const KPI_KEYS = ["created", "pipelineValue", "won", "winRate"] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

export interface KpiCard {
  key: KpiKey;
  label: string;
  value: string;
  delta: { direction: KpiDeltaDirection; text: string };
}

// Los textos que dependen de la granularidad, escritos a mano en vez de
// derivados de un "este {noun}": en español el género no acompaña ("este mes"
// pero "esta semana") y para el día "hoy"/"ayer" se lee mucho mejor que "este
// día"/"el día anterior". Son nueve combinaciones, y eso es exactamente lo que
// hay acá.
const PERIOD_COPY: Record<
  OpportunityRevenueGranularity,
  { created: string; won: string; winRate: string; comparison: string; previous: string }
> = {
  month: {
    created: "Oportunidades creadas este mes",
    won: "Ganado este mes",
    winRate: "Tasa de cierre del mes",
    comparison: "vs. mes anterior",
    previous: "el mes anterior",
  },
  week: {
    created: "Oportunidades creadas esta semana",
    won: "Ganado esta semana",
    winRate: "Tasa de cierre de la semana",
    comparison: "vs. semana anterior",
    previous: "la semana anterior",
  },
  day: {
    created: "Oportunidades creadas hoy",
    won: "Ganado hoy",
    winRate: "Tasa de cierre del día",
    comparison: "vs. ayer",
    previous: "ayer",
  },
};

// "Valor del pipeline" no sigue al selector: su rótulo y su comparación son
// siempre los mensuales.
const PIPELINE_VALUE_LABEL = "Valor del pipeline";
const MONTH_COMPARISON = PERIOD_COPY.month.comparison;

// Rótulo de cada card para una granularidad, en el orden del mockup. Lo usan
// buildKpiCards y el esqueleto de OpportunityKpiCards (que necesita los
// rótulos ANTES de que llegue el resumen), así que se escribe una sola vez.
export function kpiLabels(
  granularity: OpportunityRevenueGranularity,
): Array<{ key: KpiKey; label: string }> {
  const copy = PERIOD_COPY[granularity];
  return [
    { key: "created", label: copy.created },
    { key: "pipelineValue", label: PIPELINE_VALUE_LABEL },
    { key: "won", label: copy.won },
    { key: "winRate", label: copy.winRate },
  ];
}

// Variación relativa en %, redondeada. null cuando el período anterior es 0:
// "+∞%" no es un dato, y un 0 → 0 tampoco tiene variación.
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// WON / (WON + LOST) en %, redondeado. null si no se cerró nada en el
// período: no se divide por cero.
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost;
  if (closed === 0) return null;
  return Math.round((won / closed) * 100);
}

function directionOf(delta: number): KpiDeltaDirection {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "neutral";
}

function signed(value: number, suffix: string): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${suffix}`;
}

// El texto de "no hay con qué comparar" nombra la ventana anterior, así que
// también sigue al período — salvo en "Valor del pipeline", que pasa el mes.
function sinBase(previous: string) {
  return { direction: "neutral" as const, text: `— sin base de comparación ${previous}` };
}

export function buildKpiCards(summary: OpportunityDashboardSummary): KpiCard[] {
  const copy = PERIOD_COPY[summary.granularity];

  // Oportunidades CREADAS en la ventana elegida (createdAt es inmutable). Hasta
  // el §35 esta card mostraba "cuántas están abiertas ahora" con una variación
  // de creadas por mes al lado, dos cosas distintas en la misma card; ahora el
  // número grande y la variación son lo mismo, medido en la misma ventana.
  const createdDelta = summary.createdThisPeriod.count - summary.createdLastPeriod.count;

  // La única que NO sigue al selector: el valor de lo abierto ahora, con su
  // variación siempre sobre el valor CREADO en el mes (el estado de hace un mes
  // no se puede reconstruir, ver el service).
  const newValueDelta = percentDelta(
    Number(summary.createdThisMonth.value),
    Number(summary.createdLastMonth.value),
  );

  const wonDelta = percentDelta(
    Number(summary.wonThisPeriod.value),
    Number(summary.wonLastPeriod.value),
  );

  const rateThisPeriod = winRate(summary.wonThisPeriod.count, summary.lostCountThisPeriod);
  const rateLastPeriod = winRate(summary.wonLastPeriod.count, summary.lostCountLastPeriod);
  // En puntos porcentuales, no relativa: "+7 pts", para no confundirla con
  // los "%" de variación en $ de las otras cards.
  const ratePoints =
    rateThisPeriod !== null && rateLastPeriod !== null ? rateThisPeriod - rateLastPeriod : null;

  const byKey: Record<KpiKey, Pick<KpiCard, "value" | "delta">> = {
    created: {
      value: String(summary.createdThisPeriod.count),
      delta: {
        direction: directionOf(createdDelta),
        text: `${signed(createdDelta, "")} ${copy.comparison}`,
      },
    },
    pipelineValue: {
      value: formatAmount(summary.openValue, summary.currency),
      delta:
        newValueDelta === null
          ? sinBase(PERIOD_COPY.month.previous)
          : {
              direction: directionOf(newValueDelta),
              text: `${signed(newValueDelta, "%")} en valor nuevo ${MONTH_COMPARISON}`,
            },
    },
    won: {
      value: formatAmount(summary.wonThisPeriod.value, summary.currency),
      delta:
        wonDelta === null
          ? sinBase(copy.previous)
          : {
              direction: directionOf(wonDelta),
              text: `${signed(wonDelta, "%")} ${copy.comparison}`,
            },
    },
    winRate: {
      value: rateThisPeriod === null ? "—" : `${rateThisPeriod}%`,
      delta:
        ratePoints === null
          ? sinBase(copy.previous)
          : {
              direction: directionOf(ratePoints),
              text: `${signed(ratePoints, " pts")} ${copy.comparison}`,
            },
    },
  };

  // El orden y los rótulos salen de kpiLabels: una sola fuente para las cards
  // y para el esqueleto que se dibuja mientras carga.
  return kpiLabels(summary.granularity).map(({ key, label }) => ({ key, label, ...byKey[key] }));
}
