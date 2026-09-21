import { useQuery } from "@tanstack/react-query";
import { getResource, getWorkingHours, listResources } from "./api";
import type { ResourceListQuery } from "./types";

// Misma forma jerárquica que branchKeys/companyKeys. El horario cuelga del
// detalle del recurso: invalidar detail(id) lo alcanza también.
export const resourceKeys = {
  all: ["resources"] as const,
  lists: () => [...resourceKeys.all, "list"] as const,
  list: (query: ResourceListQuery) => [...resourceKeys.lists(), query] as const,
  details: () => [...resourceKeys.all, "detail"] as const,
  detail: (id: string) => [...resourceKeys.details(), id] as const,
  workingHours: (id: string) => [...resourceKeys.detail(id), "working-hours"] as const,
};

// La query que comparten ResourceSelect y la resolución de nombres de
// ServiceTypeListPage y BookingListPage — mismo criterio que
// BRANCHES_PARA_SELECT: pedir exactamente la misma forma hace que TanStack Query
// la dedupe en una sola request. SIN filtro de sucursal a propósito: el filtro
// por sucursal lo hace ResourceSelect localmente, y así la misma página sirve
// para resolver el nombre de un recurso de cualquier sucursal. pageSize:100 es
// el tope del contrato — más de 100 recursos en la organización no se ven en
// el picker, mismo riesgo residual que BranchSelect y UserSelect.
export const RESOURCES_PARA_SELECT: ResourceListQuery = {
  pageSize: 100,
  sortBy: "name",
  sortOrder: "asc",
};

export function useResources(query: ResourceListQuery) {
  return useQuery({
    queryKey: resourceKeys.list(query),
    queryFn: ({ signal }) => listResources(query, signal),
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: resourceKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getResource(id ?? "", signal),
    enabled: id !== undefined,
  });
}

export function useWorkingHours(resourceId: string | undefined) {
  return useQuery({
    queryKey: resourceKeys.workingHours(resourceId ?? ""),
    queryFn: ({ signal }) => getWorkingHours(resourceId ?? "", signal),
    enabled: resourceId !== undefined,
  });
}
