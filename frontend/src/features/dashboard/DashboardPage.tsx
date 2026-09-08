import { VehicleSummaryCards } from "../vehicle/VehicleSummaryCards";
import { OpportunitySummaryCards } from "./OpportunitySummaryCards";
import { PipelineStageSummary } from "./PipelineStageSummary";
import { QuickActions } from "./QuickActions";
import { RecentOpenOpportunities } from "./RecentOpenOpportunities";

// Reemplaza a HomePlaceholder en "/" (ver router.tsx) — vive detrás de
// ProtectedRoute + AppLayout, igual que el placeholder que reemplaza. Cada
// sección es un componente independiente con su propio query: una que
// falla no bloquea a las demás (degradación por sección, ver informe de
// diseño de M8).
//
// Layout: KPIs de stock arriba de todo (el mockup del dashboard pone el
// stock de vehículos por encima del resumen del embudo — Fase 3b del módulo
// de vehículos, mismo componente que encabeza el listado de stock), fila de
// KPI comercial, recientes + pipeline lado a lado (colapsan a una columna en
// pantallas angostas, ver .ds-card-grid), acciones rápidas al pie.
export function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div className="ds-stack">
        <VehicleSummaryCards />
        <OpportunitySummaryCards />
        <div className="ds-card-grid">
          <RecentOpenOpportunities />
          <PipelineStageSummary />
        </div>
        <QuickActions />
      </div>
    </div>
  );
}
