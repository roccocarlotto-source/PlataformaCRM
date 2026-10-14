import { useQuery } from "@tanstack/react-query";
import {
  leerConfiguracion,
  listarOrdenes,
  listarTipos,
  listarUsuarios,
  listarVehiculos,
  obtenerOrden,
  obtenerVehiculo,
  ordenesDelVehiculo,
} from "./api";
import type { OrdenesQuery, VehiculosQuery } from "./types";

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

export const ordenKeys = {
  all: ["servicios", "ordenes"] as const,
  lists: () => [...ordenKeys.all, "list"] as const,
  list: (query: OrdenesQuery) => [...ordenKeys.lists(), query] as const,
  detail: (id: string) => [...ordenKeys.all, "detail", id] as const,
};

export const tallerKeys = {
  configuracion: ["servicios", "configuracion"] as const,
  todosLosTipos: ["servicios", "tipos"] as const,
  tipos: (soloActivos: boolean) => ["servicios", "tipos", soloActivos] as const,
  usuarios: ["servicios", "usuarios"] as const,
};

export function useOrdenes(query: OrdenesQuery) {
  return useQuery({
    queryKey: ordenKeys.list(query),
    queryFn: ({ signal }) => listarOrdenes(query, signal),
  });
}

export function useOrden(id: string) {
  return useQuery({
    queryKey: ordenKeys.detail(id),
    queryFn: ({ signal }) => obtenerOrden(id, signal),
  });
}

export function useUsuariosDelTaller() {
  return useQuery({
    queryKey: tallerKeys.usuarios,
    queryFn: ({ signal }) => listarUsuarios(signal),
  });
}

export function useConfiguracionDelTaller() {
  return useQuery({
    queryKey: tallerKeys.configuracion,
    queryFn: ({ signal }) => leerConfiguracion(signal),
  });
}

export function useTiposDeService(soloActivos: boolean) {
  return useQuery({
    queryKey: tallerKeys.tipos(soloActivos),
    queryFn: ({ signal }) => listarTipos(soloActivos, signal),
  });
}
