import { useQuery } from "@tanstack/react-query";
import {
  getOpportunityDashboardSummary,
  getOpportunityStageCounts,
  getRevenueSeries,
} from "../opportunity/api";
import { opportunityKeys } from "../opportunity/queries";
import type { OpportunityRevenueGranularity } from "../opportunity/types";

// Dashboard no es dueño de ningún recurso propio: no se crea dashboardKeys ni
// ninguna cache paralela. Las únicas keys propias son las de los dos
// agregados del Dashboard (el resumen comercial y la serie de ingresos), que
// no tienen más filtro que la granularidad del selector de período; los
// conteos por etapa cuelgan de opportunityKeys.lists().

// Resumen comercial (§30 de docs/frontend-cambios-pendientes.md, con la
// granularidad del §35): el primer agregado real del backend
// (GET /opportunities/dashboard-summary — conteos y SUM de amount en la moneda
// de la organización, ventana en curso vs. anterior). Un solo useQuery por
// granularidad; los dos consumidores (las KPI cards y TopDealsList, que solo
// necesita la moneda) comparten esa key y por lo tanto un solo request. Las
// variaciones y el "—" cuando no hay base de comparación se calculan en
// kpi.ts: el backend manda números crudos, el frontend decide formato — mismo
// criterio que StatusCount/DefaultPipelineStageSummary.
//
// La granularidad va en la key, mismo patrón que useRevenueSeries: cada
// período se cachea aparte y volver a uno ya visto es instantáneo, sin
// invalidar los otros.
//
// No cuelga de opportunityKeys a propósito: no es un listado ni un detalle,
// y las mutaciones de Opportunity invalidan lists()/detail(), no esto. El
// resumen se refresca por staleTime/refetch al volver al Dashboard (defaults
// de lib/queryClient.ts), que para un tablero de KPIs alcanza.
export function dashboardSummaryKey(granularity: OpportunityRevenueGranularity) {
  return ["dashboard", "summary", granularity] as const;
}

export function useDashboardSummary(granularity: OpportunityRevenueGranularity) {
  return useQuery({
    queryKey: dashboardSummaryKey(granularity),
    queryFn: ({ signal }) => getOpportunityDashboardSummary(granularity, signal),
  });
}

// Serie de ingresos del gráfico (§33). Key propia y NO derivada de la del
// resumen: aunque desde el §35 las dos se piden con la misma granularidad,
// son dos respuestas distintas (N buckets contra un puñado de agregados) y
// cada una se refetchea por su cuenta.
export function useRevenueSeries(granularity: OpportunityRevenueGranularity) {
  return useQuery({
    queryKey: ["dashboard", "revenue-series", granularity] as const,
    queryFn: ({ signal }) => getRevenueSeries(granularity, signal),
  });
}

export interface StageOpportunityCount {
  stageId: string;
  name: string;
  order: number;
  total: number | null;
  isLoading: boolean;
  isError: boolean;
}

export interface DefaultPipelineStageSummary {
  isLoadingPipelines: boolean;
  isErrorPipelines: boolean;
  errorPipelines: Error | null;
  hasDefaultPipeline: boolean;
  isLoadingStages: boolean;
  isErrorStages: boolean;
  errorStages: Error | null;
  stages: StageOpportunityCount[];
}

// Sin amount por stage: el único SUM que expone el backend es el del resumen
// comercial (useDashboardSummary), que no desglosa por etapa.
//
// AHORA: un solo GET /opportunities/stage-counts (el proceso por defecto, sus
// etapas en orden y el conteo de cada una). Eran 8 pedidos y ~42 consultas en
// el Dashboard del Taller Demo; ahora 1 y ~5. La forma que devuelve el hook
// es la misma: un solo estado de carga y de error para todo (los de
// "etapas" y de cada conteo quedan siempre en false). La key cuelga de
// opportunityKeys.lists(): mover o crear una oportunidad la refresca, como
// antes los conteos por etapa; renombrar una etapa se ve al vencer el
// staleTime o al volver al Dashboard.
export function useDefaultPipelineStageSummary(): DefaultPipelineStageSummary {
  const query = useQuery({
    queryKey: [...opportunityKeys.lists(), "stage-counts"] as const,
    queryFn: ({ signal }) => getOpportunityStageCounts(signal),
  });

  return {
    isLoadingPipelines: query.isLoading,
    isErrorPipelines: query.isError,
    errorPipelines: query.error instanceof Error ? query.error : null,
    hasDefaultPipeline: query.isSuccess && query.data.pipeline !== null,
    isLoadingStages: false,
    isErrorStages: false,
    errorStages: null,
    stages: (query.data?.stages ?? []).map((stage) => ({
      stageId: stage.id,
      name: stage.name,
      order: stage.order,
      total: stage.total,
      isLoading: false,
      isError: false,
    })),
  };
}
