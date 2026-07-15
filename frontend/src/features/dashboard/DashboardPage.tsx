import { OpportunitySummaryCards } from "./OpportunitySummaryCards";
import { PipelineStageSummary } from "./PipelineStageSummary";
import { QuickActions } from "./QuickActions";
import { RecentOpenOpportunities } from "./RecentOpenOpportunities";

// Reemplaza a HomePlaceholder en "/" (ver router.tsx) — vive detrás de
// ProtectedRoute + AppLayout, igual que el placeholder que reemplaza. Cada
// sección es un componente independiente con su propio query: una que
// falla no bloquea a las demás (degradación por sección, ver informe de
// diseño de M8).
export function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <OpportunitySummaryCards />
      <RecentOpenOpportunities />
      <PipelineStageSummary />
      <QuickActions />
    </div>
  );
}
