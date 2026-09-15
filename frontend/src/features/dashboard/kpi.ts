import { formatAmount } from "../opportunity/format";
import type { OpportunityDashboardSummary } from "../opportunity/types";

// ---------------------------------------------------------------------------
// Las cuatro cards del resumen comercial (§30 de docs/frontend-cambios-
// pendientes.md) a partir de los números crudos del backend. Lógica pura,
// sin React, probada sola (kpi.test.ts) — mismo espíritu que taskBuckets.ts.
//
// Cada card es rótulo + valor grande + una línea de variación. La variación
// tiene tres salidas: sube (verde), baja (rojo) o neutral (gris) — y neutral
// también cubre "no hay base de comparación", que se muestra como "—" en vez
// de inventar un porcentaje sobre un cero.
// ---------------------------------------------------------------------------

export type KpiDeltaDirection = "up" | "down" | "neutral";

export interface KpiCard {
  key: "open" | "pipelineValue" | "wonThisMonth" | "winRate";
  label: string;
  value: string;
  delta: { direction: KpiDeltaDirection; text: string };
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

const SIN_BASE = "— sin base de comparación el mes anterior";

export function buildKpiCards(summary: OpportunityDashboardSummary): KpiCard[] {
  // Abiertas ahora mismo; la variación es sobre las CREADAS en cada mes
  // (createdAt es inmutable), no sobre "cuántas estaban abiertas hace un
  // mes", que no se puede reconstruir. El texto lo dice.
  const newDeals = summary.createdThisMonth.count - summary.createdLastMonth.count;

  const newValueDelta = percentDelta(
    Number(summary.createdThisMonth.value),
    Number(summary.createdLastMonth.value),
  );

  const wonDelta = percentDelta(
    Number(summary.wonThisMonth.value),
    Number(summary.wonLastMonth.value),
  );

  const rateThisMonth = winRate(summary.wonThisMonth.count, summary.lostCountThisMonth);
  const rateLastMonth = winRate(summary.wonLastMonth.count, summary.lostCountLastMonth);
  // En puntos porcentuales, no relativa: "+7 pts", para no confundirla con
  // los "%" de variación en $ de las otras cards.
  const ratePoints =
    rateThisMonth !== null && rateLastMonth !== null ? rateThisMonth - rateLastMonth : null;

  return [
    {
      key: "open",
      label: "Oportunidades abiertas",
      value: String(summary.openCount),
      delta: {
        direction: directionOf(newDeals),
        text: `${signed(newDeals, "")} nuevas oportunidades vs. mes anterior`,
      },
    },
    {
      key: "pipelineValue",
      label: "Valor del pipeline",
      value: formatAmount(summary.openValue, summary.currency),
      delta:
        newValueDelta === null
          ? { direction: "neutral", text: SIN_BASE }
          : {
              direction: directionOf(newValueDelta),
              text: `${signed(newValueDelta, "%")} en valor nuevo vs. mes anterior`,
            },
    },
    {
      key: "wonThisMonth",
      label: "Ganado este mes",
      value: formatAmount(summary.wonThisMonth.value, summary.currency),
      delta:
        wonDelta === null
          ? { direction: "neutral", text: SIN_BASE }
          : { direction: directionOf(wonDelta), text: `${signed(wonDelta, "%")} vs. mes anterior` },
    },
    {
      key: "winRate",
      label: "Tasa de cierre del mes",
      value: rateThisMonth === null ? "—" : `${rateThisMonth}%`,
      delta:
        ratePoints === null
          ? { direction: "neutral", text: SIN_BASE }
          : {
              direction: directionOf(ratePoints),
              text: `${signed(ratePoints, " pts")} vs. mes anterior`,
            },
    },
  ];
}
