import { useQuery } from "@tanstack/react-query";
import { getLote, getOpciones, listarFilas, listarLotes } from "./api";
import type { EstadoDelLote, TipoDePlan } from "./types";

export const importacionKeys = {
  all: ["importacion"] as const,
  opciones: (organizationId: string) =>
    [...importacionKeys.all, "opciones", organizationId] as const,
  lotes: (organizationId: string) => [...importacionKeys.all, "lotes", organizationId] as const,
  lote: (organizationId: string, batchId: string) =>
    [...importacionKeys.all, "lote", organizationId, batchId] as const,
  filas: (organizationId: string, batchId: string, filtro: object) =>
    [...importacionKeys.all, "filas", organizationId, batchId, filtro] as const,
};

export function useOpciones(organizationId: string) {
  return useQuery({
    queryKey: importacionKeys.opciones(organizationId),
    queryFn: ({ signal }) => getOpciones(organizationId, signal),
    enabled: organizationId !== "",
  });
}

export function useLotes(organizationId: string) {
  return useQuery({
    queryKey: importacionKeys.lotes(organizationId),
    queryFn: ({ signal }) => listarLotes(organizationId, signal),
    enabled: organizationId !== "",
  });
}

// Mientras el worker trabaja (vista previa o promoción), se vuelve a pedir
// cada 2 segundos: es lo que muestra el progreso.
const EN_CURSO: EstadoDelLote[] = ["ANALYZING", "RUNNING", "UNDOING"];
export const INTERVALO_DE_PROGRESO_MS = 2000;

export function useLote(organizationId: string, batchId: string) {
  return useQuery({
    queryKey: importacionKeys.lote(organizationId, batchId),
    queryFn: ({ signal }) => getLote(organizationId, batchId, signal),
    enabled: organizationId !== "" && batchId !== "",
    refetchInterval: (query) =>
      query.state.data && EN_CURSO.includes(query.state.data.lote.status)
        ? INTERVALO_DE_PROGRESO_MS
        : false,
  });
}

export function useFilas(
  organizationId: string,
  batchId: string,
  filtro: { tipo?: TipoDePlan; page: number; pageSize: number },
  enabled = true,
) {
  return useQuery({
    queryKey: importacionKeys.filas(organizationId, batchId, filtro),
    queryFn: ({ signal }) => listarFilas(organizationId, batchId, filtro, signal),
    enabled: enabled && organizationId !== "" && batchId !== "",
  });
}
