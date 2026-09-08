import { useQueries, useQuery } from "@tanstack/react-query";
import { getVehicle, getVehicleChangeLog, listVehicles } from "./api";
import type { VehicleChangeLogQuery, VehicleListQuery } from "./types";

// Query keys explícitas y estables, mismo criterio que companyKeys: sin
// namespacing por organizationId, la higiene entre identidades la da
// queryClient.clear() en la frontera de AuthContext.
export const vehicleKeys = {
  all: ["vehicles"] as const,
  lists: () => [...vehicleKeys.all, "list"] as const,
  list: (query: VehicleListQuery) => [...vehicleKeys.lists(), query] as const,
  details: () => [...vehicleKeys.all, "detail"] as const,
  detail: (id: string) => [...vehicleKeys.details(), id] as const,
  changeLog: (id: string, query: VehicleChangeLogQuery) =>
    [...vehicleKeys.detail(id), "change-log", query] as const,
};

export function useVehicles(query: VehicleListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: vehicleKeys.list(query),
    queryFn: ({ signal }) => listVehicles(query, signal),
    enabled: options?.enabled,
  });
}

export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: vehicleKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getVehicle(id ?? "", signal),
    enabled: id !== undefined,
  });
}

export function useVehicleChangeLog(id: string, query: VehicleChangeLogQuery) {
  return useQuery({
    queryKey: vehicleKeys.changeLog(id, query),
    queryFn: ({ signal }) => getVehicleChangeLog(id, query, signal),
  });
}

export interface VehicleCount {
  total: number | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

// Los dos KPI del listado, conteos EXACTOS vía pagination.total de una query
// con pageSize=1 — mismo patrón que useOpportunitySummary (dashboard/queries.ts).
// "En stock" = sin filtro de status; "Disponibles" = status AVAILABLE. Sin
// "valor de stock" ni "días promedio en stock": el backend no expone SUM ni
// AVG, y sumar client-side las filas de la página visible mentiría apenas
// hubiera más de una página. Si algún día se quieren, es un endpoint de
// agregados en el backend, no algo que se resuelva acá.
const SUMMARY_QUERIES: VehicleListQuery[] = [
  { pageSize: 1 },
  { pageSize: 1, status: ["AVAILABLE"] },
];

export function useVehicleSummary(): Record<"inStock" | "available", VehicleCount> {
  const results = useQueries({
    queries: SUMMARY_QUERIES.map((query) => ({
      queryKey: vehicleKeys.list(query),
      queryFn: ({ signal }: { signal: AbortSignal }) => listVehicles(query, signal),
    })),
  });

  function toCount(result: (typeof results)[number]): VehicleCount {
    return {
      total: result.data?.pagination.total ?? null,
      isLoading: result.isLoading,
      isError: result.isError,
      error: result.error instanceof Error ? result.error : null,
    };
  }

  return { inStock: toCount(results[0]), available: toCount(results[1]) };
}
