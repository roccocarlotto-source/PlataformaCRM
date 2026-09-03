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
// Layout: fila de KPI arriba, recientes + pipeline lado a lado (colapsan a
// una columna en pantallas angostas, ver .ds-card-grid), acciones rápidas
// al pie. Solo restyle: mismas 4 secciones, mismos datos.
export function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div className="ds-stack">
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
