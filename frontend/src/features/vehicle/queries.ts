import { useQuery } from "@tanstack/react-query";
import { getVehicle, getVehicleChangeLog, getVehicleSummary, listVehicles } from "./api";
import type { VehicleChangeLogQuery, VehicleListQuery } from "./types";

// Query keys explícitas y estables, mismo criterio que companyKeys: sin
// namespacing por organizationId, la higiene entre identidades la da
// queryClient.clear() en la frontera de AuthContext.
export const vehicleKeys = {
  all: ["vehicles"] as const,
  lists: () => [...vehicleKeys.all, "list"] as const,
  list: (query: VehicleListQuery) => [...vehicleKeys.lists(), query] as const,
  // Bajo lists(): las mutaciones de stock, que invalidan los listados, también
  // refrescan el resumen.
  summary: () => [...vehicleKeys.lists(), "summary"] as const,
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

// Los dos KPI del listado, conteos EXACTOS de GET /vehicles/summary (desde el
// ensayo del 2026-10-17; antes, dos GET /vehicles con pageSize=1 y su
// pagination.total). "En stock" = sin filtro de status; "Disponibles" =
// status AVAILABLE. Sin
// "valor de stock" ni "días promedio en stock": el backend no expone SUM ni
// AVG, y sumar client-side las filas de la página visible mentiría apenas
// hubiera más de una página. Si algún día se quieren, es un endpoint de
// agregados en el backend, no algo que se resuelva acá.

export function useVehicleSummary(): Record<"inStock" | "available", VehicleCount> {
  const query = useQuery({
    queryKey: vehicleKeys.summary(),
    queryFn: ({ signal }) => getVehicleSummary(signal),
  });

  function toCount(total: number | undefined): VehicleCount {
    return {
      total: total ?? null,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error instanceof Error ? query.error : null,
    };
  }

  return { inStock: toCount(query.data?.inStock), available: toCount(query.data?.available) };
}
