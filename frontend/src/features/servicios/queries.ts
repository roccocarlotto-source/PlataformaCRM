import { useQuery } from "@tanstack/react-query";
import { listarVehiculos, obtenerVehiculo, ordenesDelVehiculo } from "./api";
import type { VehiculosQuery } from "./types";

// Mismo criterio que companyKeys: claves estables, sin organizationId (la
// higiene entre identidades la da queryClient.clear() en AuthContext).
export const vehiculoKeys = {
  all: ["servicios", "vehiculos"] as const,
  lists: () => [...vehiculoKeys.all, "list"] as const,
  list: (query: VehiculosQuery) => [...vehiculoKeys.lists(), query] as const,
  details: () => [...vehiculoKeys.all, "detail"] as const,
  detail: (id: string) => [...vehiculoKeys.details(), id] as const,
  ordenes: (id: string) => [...vehiculoKeys.detail(id), "ordenes"] as const,
};

export function useVehiculos(query: VehiculosQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: vehiculoKeys.list(query),
    queryFn: ({ signal }) => listarVehiculos(query, signal),
    enabled: options?.enabled,
  });
}

export function useVehiculo(id: string | undefined) {
  return useQuery({
    queryKey: vehiculoKeys.detail(id ?? ""),
    queryFn: ({ signal }) => obtenerVehiculo(id ?? "", signal),
    enabled: id !== undefined,
  });
}

export function useOrdenesDelVehiculo(id: string) {
  return useQuery({
    queryKey: vehiculoKeys.ordenes(id),
    queryFn: ({ signal }) => ordenesDelVehiculo(id, signal),
  });
}
