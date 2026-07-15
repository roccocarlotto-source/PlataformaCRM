import { useQueries, useQuery } from "@tanstack/react-query";
import { listOpportunities } from "../opportunity/api";
import { opportunityKeys } from "../opportunity/queries";
import type { OpportunityStatus } from "../opportunity/types";
import { usePipelines } from "../pipeline/queries";
import type { Pipeline } from "../pipeline/types";
import { useStages } from "../stage/queries";
import type { Stage } from "../stage/types";

// Dashboard no es dueño de ningún recurso propio: cada hook de acá compone
// listOpportunities/listPipelines(usePipelines)/listStages(useStages) ya
// existentes, con sus propias key factories (opportunityKeys/pipelineKeys/
// stageKeys) — no se crea dashboardKeys ni ninguna cache paralela.

const SUMMARY_STATUSES: OpportunityStatus[] = ["OPEN", "WON", "LOST"];

export interface StatusCount {
  total: number | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

// Total exacto por status vía pagination.total de una consulta pageSize=1 —
// nunca items.length. Sin SUM de amount (no soportado por el backend, ver
// informe de diseño de M8): estas 3 cards son las únicas category A del
// resumen comercial.
export function useOpportunitySummary(): Record<"open" | "won" | "lost", StatusCount> {
  const results = useQueries({
    queries: SUMMARY_STATUSES.map((status) => {
      const query = { status, pageSize: 1 } as const;
      return {
        queryKey: opportunityKeys.list(query),
        queryFn: ({ signal }: { signal: AbortSignal }) => listOpportunities(query, signal),
      };
    }),
  });

  function toStatusCount(result: (typeof results)[number]): StatusCount {
    return {
      total: result.data?.pagination.total ?? null,
      isLoading: result.isLoading,
      isError: result.isError,
      error: result.error instanceof Error ? result.error : null,
    };
  }

  return {
    open: toStatusCount(results[0]),
    won: toStatusCount(results[1]),
    lost: toStatusCount(results[2]),
  };
}

const RECENT_OPEN_LIMIT = 5;

// ownerId=me.id: nunca requiere GET /api/users (a diferencia de resolver el
// nombre de OTRO usuario) — el id del usuario actual ya está en
// AuthContext. `enabled` gatea el fetch hasta que el caller tenga un
// ownerId real, mismo criterio que useStage/useOpportunity con `id ?? ""` +
// `enabled: id !== undefined`.
export function useMyRecentOpenOpportunities(ownerId: string | undefined) {
  const query = {
    ownerId,
    status: "OPEN" as const,
    sortBy: "createdAt" as const,
    sortOrder: "desc" as const,
    pageSize: RECENT_OPEN_LIMIT,
  };

  return useQuery({
    queryKey: opportunityKeys.list(query),
    queryFn: ({ signal }) => listOpportunities(query, signal),
    enabled: ownerId !== undefined,
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
// Nunca se muestra amount por stage: el backend no soporta SUM.
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
