import { useQuery } from "@tanstack/react-query";
import { listIngestionEvents } from "./api";
import type { IngestionEventListQuery } from "./types";

// Misma forma jerárquica que sourceKeys/apiKeyKeys.
//
// SIN `detail`, igual que apiKeyKeys y por la misma razón: no existe
// GET /api/ingestion-events/:id en el backend. Declarar una key para una query
// imposible sería una invitación a escribirla.
export const ingestionEventKeys = {
  all: ["ingestion-events"] as const,
  lists: () => [...ingestionEventKeys.all, "list"] as const,
  list: (query: IngestionEventListQuery) => [...ingestionEventKeys.lists(), query] as const,
};

// SIN polling ni auto-refresh. La cola cambia sola —el worker promueve eventos
// en su propia pasada— así que la tentación es un refetchInterval, y
// deliberadamente no está: se refresca por invalidación (el reintento propio, o
// una importación exitosa) y por los filtros/paginación, que son acciones de la
// persona. Mismo criterio que el resto del proyecto.
export function useIngestionEvents(
  query: IngestionEventListQuery,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ingestionEventKeys.list(query),
    queryFn: ({ signal }) => listIngestionEvents(query, signal),
    enabled: options?.enabled,
  });
}
