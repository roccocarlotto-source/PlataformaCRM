import { useQuery } from "@tanstack/react-query";
import { getOpportunity, listOpportunities } from "./api";
import type { OpportunityListQuery } from "./types";

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

export function useOpportunities(query: OpportunityListQuery) {
  return useQuery({
    queryKey: opportunityKeys.list(query),
    queryFn: ({ signal }) => listOpportunities(query, signal),
  });
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    queryKey: opportunityKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getOpportunity(id ?? "", signal),
    enabled: id !== undefined,
  });
}
