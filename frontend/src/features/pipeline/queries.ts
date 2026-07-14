import { useQuery } from "@tanstack/react-query";
import { getPipeline, listPipelines } from "./api";
import type { PipelineListQuery } from "./types";

// Mismo shape que companyKeys/contactKeys — Pipeline no está scoped bajo
// ninguna otra entidad, a diferencia de Stage (ver stage/queries.ts).
export const pipelineKeys = {
  all: ["pipelines"] as const,
  lists: () => [...pipelineKeys.all, "list"] as const,
  list: (query: PipelineListQuery) => [...pipelineKeys.lists(), query] as const,
  details: () => [...pipelineKeys.all, "detail"] as const,
  detail: (id: string) => [...pipelineKeys.details(), id] as const,
};

export function usePipelines(query: PipelineListQuery) {
  return useQuery({
    queryKey: pipelineKeys.list(query),
    queryFn: ({ signal }) => listPipelines(query, signal),
  });
}

export function usePipeline(id: string | undefined) {
  return useQuery({
    queryKey: pipelineKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getPipeline(id ?? "", signal),
    enabled: id !== undefined,
  });
}
