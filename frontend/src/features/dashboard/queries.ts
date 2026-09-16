import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getOpportunityDashboardSummary,
  getRevenueSeries,
  listOpportunities,
} from "../opportunity/api";
import { opportunityKeys } from "../opportunity/queries";
import type { OpportunityRevenueGranularity } from "../opportunity/types";
import { usePipelines } from "../pipeline/queries";
import type { Pipeline } from "../pipeline/types";
import { useStages } from "../stage/queries";
import type { Stage } from "../stage/types";

// Dashboard no es dueño de ningún recurso propio: los hooks de acá componen
// listOpportunities/listPipelines(usePipelines)/listStages(useStages) ya
// existentes, con sus propias key factories (opportunityKeys/pipelineKeys/
// stageKeys) — no se crea dashboardKeys ni ninguna cache paralela. Las únicas
// keys propias son las de los dos agregados del Dashboard (el resumen
// comercial y la serie de ingresos), que no tienen más filtro que la
// granularidad del selector de período.

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

const PIPELINE_LOOKUP_QUERY = { pageSize: 100 } as const;

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

// Encadenado en 3 pasos, cada uno dependiente del anterior por ID real (no
// se dispara ningún paso sin el ID que necesita):
//   1. pipelines (pageSize=100) → identificar isDefault===true client-side
//      (el backend no expone un filtro isDefault, ver informe de diseño).
//   2. stages del default, ordenadas por order asc (useStages ya soporta
//      `enabled`) — nunca se pide sin un pipelineId real.
//   3. por cada stage: conteo exacto de Opportunities vía
//      pipelineId+stageId+pageSize=1 → pagination.total, en paralelo entre
//      sí. Si no hay stages (sin default, o default sin etapas), este
//      arreglo queda vacío y no se dispara ningún GET /opportunities.
// Sin amount por stage: el único SUM que expone el backend es el del resumen
// comercial (useDashboardSummary), que no desglosa por etapa.
export function useDefaultPipelineStageSummary(): DefaultPipelineStageSummary {
  const pipelinesQuery = usePipelines(PIPELINE_LOOKUP_QUERY);

  const defaultPipeline: Pipeline | undefined = pipelinesQuery.data?.data.find(
    (pipeline) => pipeline.isDefault,
  );
  const hasDefaultPipeline = pipelinesQuery.isSuccess && defaultPipeline !== undefined;

  const stagesQuery = useStages(
    defaultPipeline?.id ?? "",
    {
      pipelineId: defaultPipeline?.id,
      pageSize: 100,
      sortBy: "order",
      sortOrder: "asc",
    },
    { enabled: defaultPipeline !== undefined },
  );

  const stages: Stage[] = stagesQuery.data?.data ?? [];

  const countResults = useQueries({
    queries: stages.map((stage) => {
      const query = { pipelineId: stage.pipelineId, stageId: stage.id, pageSize: 1 } as const;
      return {
        queryKey: opportunityKeys.list(query),
        queryFn: ({ signal }: { signal: AbortSignal }) => listOpportunities(query, signal),
      };
    }),
  });

  const stageCounts: StageOpportunityCount[] = stages.map((stage, index) => {
    const result = countResults[index];
    return {
      stageId: stage.id,
      name: stage.name,
      order: stage.order,
      total: result?.data?.pagination.total ?? null,
      isLoading: result?.isLoading ?? false,
      isError: result?.isError ?? false,
    };
  });

  return {
    isLoadingPipelines: pipelinesQuery.isLoading,
    isErrorPipelines: pipelinesQuery.isError,
    errorPipelines: pipelinesQuery.error instanceof Error ? pipelinesQuery.error : null,
    hasDefaultPipeline,
    isLoadingStages: stagesQuery.isLoading,
    isErrorStages: stagesQuery.isError,
    errorStages: stagesQuery.error instanceof Error ? stagesQuery.error : null,
    stages: stageCounts,
  };
}
