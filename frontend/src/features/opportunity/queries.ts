import { useQueries, useQuery } from "@tanstack/react-query";
import { getOpportunity, listOpportunities } from "./api";
import type { Opportunity, OpportunityListQuery } from "./types";

// Plana, mismo shape que companyKeys/contactKeys/pipelineKeys — NO
// jerárquica como stageKeys: Opportunity no está scoped a un único padre
// obligatorio por URL. company/contact/pipeline/stage/owner son filtros
// OPCIONALES de un listado de primer nivel, no un parámetro de ruta fijo.
export const opportunityKeys = {
  all: ["opportunities"] as const,
  lists: () => [...opportunityKeys.all, "list"] as const,
  list: (query: OpportunityListQuery) => [...opportunityKeys.lists(), query] as const,
  details: () => [...opportunityKeys.all, "detail"] as const,
  detail: (id: string) => [...opportunityKeys.details(), id] as const,
};

// options.enabled — mismo motivo que useStages (stage/queries.ts): el
// embudo monta su listado antes de tener un pipeline elegido, y sin esto
// dispararía un GET /opportunities sin pipelineId (todas las de la
// organización). undefined → true, ningún caller existente cambia.
export function useOpportunities(query: OpportunityListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: opportunityKeys.list(query),
    queryFn: ({ signal }) => listOpportunities(query, signal),
    enabled: options?.enabled,
  });
}

// Tope real del backend para pageSize (opportunity.controller.ts,
// listQuerySchema) — mismo límite que documentan PipelineSelect y
// StageSelect para los suyos.
const MAX_PAGE_SIZE = 100;

// TODAS las oportunidades de un pipeline, sin filtro de status (el embudo
// necesita ver también las cerradas, para las columnas Ganada/Perdida).
//
// No existe un endpoint "sin límite" y no hace falta uno: esto es
// puramente client-side sobre el listado que ya existe. La primera página
// dice cuántas hay (pagination.totalPages) y las restantes se piden en
// paralelo con useQueries — la cantidad de hooks no cambia entre renders,
// solo la longitud del array que recibe useQueries, que es lo que ese hook
// está hecho para absorber. Orden fijo por createdAt asc: no hay campo de
// posición en Opportunity, así que dentro de una columna las tarjetas van
// de la más vieja a la más nueva, siempre igual.
//
// Las páginas comparten queryKey con useOpportunities (opportunityKeys.
// list), así que la invalidación de lists() que hacen las mutaciones las
// refresca todas sin nada extra.
export function usePipelineOpportunitiesAll(pipelineId: string | undefined) {
  const baseQuery: OpportunityListQuery = {
    pipelineId,
    pageSize: MAX_PAGE_SIZE,
    sortBy: "createdAt",
    sortOrder: "asc",
  };
  const enabled = pipelineId !== undefined;

  const firstPage = useOpportunities({ ...baseQuery, page: 1 }, { enabled });
  const totalPages = firstPage.data?.pagination.totalPages ?? 0;

  const remainingPages = useQueries({
    queries: Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => {
      const query = { ...baseQuery, page: index + 2 };
      return {
        queryKey: opportunityKeys.list(query),
        queryFn: ({ signal }: { signal?: AbortSignal }) => listOpportunities(query, signal),
        enabled,
      };
    }),
  });

  const pages = [firstPage, ...remainingPages];
  const isLoading = pages.some((page) => page.isLoading);
  const failed = pages.find((page) => page.isError);
  const isSuccess = pages.every((page) => page.isSuccess);

  const data: Opportunity[] | undefined = isSuccess
    ? pages.flatMap((page) => page.data?.data ?? [])
    : undefined;

  return {
    data,
    total: firstPage.data?.pagination.total,
    isLoading,
    isError: failed !== undefined,
    error: failed?.error ?? null,
    isSuccess,
  };
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    queryKey: opportunityKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getOpportunity(id ?? "", signal),
    enabled: id !== undefined,
  });
}
