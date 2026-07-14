import { useQuery } from "@tanstack/react-query";
import { getStage, listStages } from "./api";
import type { StageListQuery } from "./types";

// Jerárquica por pipelineId — a diferencia de companyKeys/contactKeys/
// pipelineKeys (entidades de primer nivel), Stage siempre está scoped a un
// Pipeline en esta UI. pipelineId es un segmento PROPIO del array (no una
// propiedad enterrada dentro del objeto de query): esto permite invalidar
// "todas las variantes de listado/detail de un pipeline" con un simple
// prefijo de array (byPipeline(pipelineId)), sin depender del matching
// parcial dentro de un objeto — mismo modelo mental que ya usan
// companyKeys/contactKeys/pipelineKeys con lists()/list(query).
//
// Verificado empíricamente contra @tanstack/query-core real (no asumido):
// invalidateQueries({ queryKey: stageKeys.byPipeline("p1") }) marca stale
// TODAS las variantes de listado cacheadas de "p1" (distinta página/sort),
// y NINGUNA de otro pipelineId.
export const stageKeys = {
  all: ["stages"] as const,
  byPipeline: (pipelineId: string) => [...stageKeys.all, pipelineId] as const,
  lists: (pipelineId: string) => [...stageKeys.byPipeline(pipelineId), "list"] as const,
  list: (pipelineId: string, query: StageListQuery) =>
    [...stageKeys.lists(pipelineId), query] as const,
  details: (pipelineId: string) => [...stageKeys.byPipeline(pipelineId), "detail"] as const,
  detail: (pipelineId: string, id: string) => [...stageKeys.details(pipelineId), id] as const,
};

// options.enabled — agregado en M5 (StageSelect.tsx): sin esto, un
// selector de Stage montado antes de que el usuario elija un Pipeline no
// tiene forma de evitar disparar un GET /stages sin pipelineId (listaría
// etapas de TODOS los pipelines) sin violar las Reglas de Hooks. Con
// enabled:false por defecto ausente (undefined → true), no cambia el
// comportamiento de ningún caller existente (StageListPage no lo pasa).
export function useStages(
  pipelineId: string,
  query: StageListQuery,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: stageKeys.list(pipelineId, query),
    queryFn: ({ signal }) => listStages(query, signal),
    enabled: options?.enabled,
  });
}

export function useStage(pipelineId: string, id: string | undefined) {
  return useQuery({
    queryKey: stageKeys.detail(pipelineId, id ?? ""),
    queryFn: ({ signal }) => getStage(id ?? "", signal),
    enabled: id !== undefined,
  });
}
