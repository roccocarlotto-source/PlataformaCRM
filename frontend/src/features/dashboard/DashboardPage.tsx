import { VehicleSummaryCards } from "../vehicle/VehicleSummaryCards";
import { ActivityFeed } from "./ActivityFeed";
import { OpportunityKpiCards } from "./OpportunityKpiCards";
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
// de 4 KPI comerciales con su variación mensual, el gráfico de ingresos por
// mes a todo el ancho, oportunidades recientes + mayores abiertas lado a
// lado, pipeline + actividad reciente lado a lado (las parejas colapsan a
// una columna en pantallas angostas, ver .ds-card-grid), acciones rápidas al
// pie. Los montos salen de GET /opportunities/dashboard-summary, el agregado
// que M8 no tenía.
export function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div className="ds-stack">
        <VehicleSummaryCards />
        <OpportunityKpiCards />
        <RevenueByMonthChart />
        <div className="ds-card-grid">
          <RecentDealsTable />
          <TopDealsList />
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
