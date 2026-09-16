import { useState } from "react";
import type { OpportunityRevenueGranularity } from "../opportunity/types";
import { VehicleSummaryCards } from "../vehicle/VehicleSummaryCards";
import { ActivityFeed } from "./ActivityFeed";
import { OpportunityKpiCards } from "./OpportunityKpiCards";
import { PeriodToggle } from "./PeriodToggle";
import { PipelineStageSummary } from "./PipelineStageSummary";
import { QuickActions } from "./QuickActions";
import { RecentDealsTable } from "./RecentDealsTable";
import { RevenueByMonthChart } from "./RevenueByMonthChart";
import { TopDealsList } from "./TopDealsList";

// Reemplaza a HomePlaceholder en "/" (ver router.tsx) — vive detrás de
// ProtectedRoute + AppLayout, igual que el placeholder que reemplaza. Cada
// sección es un componente independiente con su propio query: una que
// falla no bloquea a las demás (degradación por sección, ver informe de
// diseño de M8).
//
// Layout (§30 de docs/frontend-cambios-pendientes.md, la distribución del
// dashboard de referencia): KPIs de stock arriba de todo (Fase 3b del módulo
// de vehículos, mismo componente que encabeza el listado de stock), la fila
// de 4 KPI comerciales con su variación, el gráfico de ingresos a todo el
// ancho, oportunidades recientes + mayores abiertas lado a
// lado, pipeline + actividad reciente lado a lado (las parejas colapsan a
// una columna en pantallas angostas, ver .ds-card-grid), acciones rápidas al
// pie. Los montos salen de GET /opportunities/dashboard-summary, el agregado
// que M8 no tenía.
//
// Desde el §35 esta página es dueña de UN estado: el período elegido. Nació en
// la tarjeta del gráfico (§33), donde cambiaba solo esa serie; ahora vive
// arriba, junto al <h1>, porque gobierna también la fila de KPIs. Baja por
// prop a los tres componentes que lo necesitan en vez de por contexto: son
// hermanos directos, y un contexto para un dato que cruza un solo nivel es
// ceremonia.
//
// Lo que el selector NO toca: las cards de stock (inventario actual), que no
// miran el resumen comercial. La otra excepción del §35, "Valor del pipeline",
// dejó de existir en el §36 — el embudo de Oportunidades ya muestra ese total
// por pipeline y multi-moneda.
export function DashboardPage() {
  const [granularity, setGranularity] = useState<OpportunityRevenueGranularity>("month");

  return (
    <div>
      {/* La misma clase que los listados para "título + acción a la derecha"
          (CompanyListPage y el resto): el selector es un control de página. */}
      <div className="ds-page-header">
        <h1>Dashboard</h1>
        <PeriodToggle value={granularity} onChange={setGranularity} />
      </div>
      <div className="ds-stack">
        <VehicleSummaryCards />
        <OpportunityKpiCards granularity={granularity} />
        <RevenueByMonthChart granularity={granularity} />
        <div className="ds-card-grid">
          <RecentDealsTable />
          <TopDealsList granularity={granularity} />
        </div>
        <div className="ds-card-grid">
          <PipelineStageSummary />
          <ActivityFeed />
        </div>
        <QuickActions />
      </div>
    </div>
  );
}
