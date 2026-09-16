import type { OpportunityRevenueGranularity } from "../opportunity/types";

// ---------------------------------------------------------------------------
// El selector de período del Dashboard (§33), sacado de RevenueByMonthChart en
// el §35. Vivía adentro del componente del gráfico mientras era suyo; desde
// que el selector gobierna toda la página —la fila de KPIs y el gráfico— ya no
// puede vivir en uno de sus consumidores: DashboardPage es dueño del estado y
// renderiza el toggle (PeriodToggle.tsx), y el gráfico lee de acá los textos
// que dependen de la granularidad.
//
// Datos puros, sin React, para poder probarlos solos — mismo espíritu que
// kpi.ts y revenueChart.ts. Los rótulos de las KPI cards NO están acá sino en
// kpi.ts, junto a la lógica que arma esas cards: son 9 combinaciones con
// género y con "hoy/ayer", no derivables de estos campos.
// ---------------------------------------------------------------------------

export interface PeriodOption {
  value: OpportunityRevenueGranularity;
  // Texto del botón del selector.
  button: string;
  // "por mes" / "por semana" / "por día" en el título de la tarjeta del
  // gráfico.
  noun: string;
  // Encabezado de la columna de la tabla accesible del gráfico.
  column: string;
  // "los últimos 6 meses" — el mismo texto sirve para el estado vacío y para
  // el aria-label del <svg>, así que se escribe una sola vez.
  window: string;
}

export const PERIODS: ReadonlyArray<PeriodOption> = [
  { value: "month", button: "Mensual", noun: "mes", column: "Mes", window: "los últimos 6 meses" },
  {
    value: "week",
    button: "Semanal",
    noun: "semana",
    column: "Semana",
    window: "las últimas 8 semanas",
  },
  { value: "day", button: "Diario", noun: "día", column: "Día", window: "los últimos 30 días" },
];

// La opción activa, con Mensual como red de seguridad: ningún llamador puede
// pasar otra cosa (el tipo lo impide), pero el `find` devuelve `undefined` y
// el resto del código no tiene por qué saberlo.
export function periodOption(granularity: OpportunityRevenueGranularity): PeriodOption {
  return PERIODS.find((option) => option.value === granularity) ?? PERIODS[0];
}
