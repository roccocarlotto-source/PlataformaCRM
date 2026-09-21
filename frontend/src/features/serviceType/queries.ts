import { useQuery } from "@tanstack/react-query";
import { getServiceType, listServiceTypes } from "./api";
import type { ServiceTypeListQuery } from "./types";

// Misma forma jerárquica que resourceKeys/branchKeys.
export const serviceTypeKeys = {
  all: ["service-types"] as const,
  lists: () => [...serviceTypeKeys.all, "list"] as const,
  list: (query: ServiceTypeListQuery) => [...serviceTypeKeys.lists(), query] as const,
  details: () => [...serviceTypeKeys.all, "detail"] as const,
  detail: (id: string) => [...serviceTypeKeys.details(), id] as const,
};

// Mismo criterio que RESOURCES_PARA_SELECT: una sola página de hasta 100, sin
// filtro de sucursal, que alimenta el filtro "Tipo de servicio" del listado de
// Reservas y la resolución de nombres de sus filas.
export const SERVICE_TYPES_PARA_SELECT: ServiceTypeListQuery = {
  pageSize: 100,
  sortBy: "name",
  sortOrder: "asc",
};

export function useServiceTypes(query: ServiceTypeListQuery) {
  return useQuery({
    queryKey: serviceTypeKeys.list(query),
    queryFn: ({ signal }) => listServiceTypes(query, signal),
  });
}

export function useServiceType(id: string | undefined) {
  return useQuery({
    queryKey: serviceTypeKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getServiceType(id ?? "", signal),
    enabled: id !== undefined,
  });
}
