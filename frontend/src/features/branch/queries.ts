import { useQuery } from "@tanstack/react-query";
import { getBranch, getGoogleCalendarConnection, listBranches } from "./api";
import type { BranchListQuery } from "./types";

// Misma forma jerárquica que userKeys/companyKeys/sourceKeys. Sin namespacing
// manual por organizationId — la higiene de cache entre identidades ya la da
// queryClient.clear() en la frontera de AuthContext.
export const branchKeys = {
  all: ["branches"] as const,
  lists: () => [...branchKeys.all, "list"] as const,
  list: (query: BranchListQuery) => [...branchKeys.lists(), query] as const,
  details: () => [...branchKeys.all, "detail"] as const,
  detail: (id: string) => [...branchKeys.details(), id] as const,
  // Cuelga del detalle: invalidar detail(id) la alcanza también.
  googleCalendar: (id: string) => [...branchKeys.detail(id), "google-calendar"] as const,
};

// La query que comparten BranchSelect y la resolución de nombres de
// QrListPage: pedir exactamente la misma forma hace que TanStack Query la
// dedupe en una sola request y una sola entrada de cache. pageSize:100 es el
// tope del contrato (listQuerySchema en branch.controller.ts) — una
// organización con más de 100 sucursales no ve el resto en este picker,
// mismo riesgo residual documentado que UserSelect.
export const BRANCHES_PARA_SELECT: BranchListQuery = {
  pageSize: 100,
  sortBy: "name",
  sortOrder: "asc",
};

export function useBranches(query: BranchListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: branchKeys.list(query),
    queryFn: ({ signal }) => listBranches(query, signal),
    enabled: options?.enabled,
  });
}

export function useBranch(id: string | undefined) {
  return useQuery({
    queryKey: branchKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getBranch(id ?? "", signal),
    enabled: id !== undefined,
  });
}

// El estado de la conexión con Google Calendar (ítem 75). null = nunca se
// conectó (ver getGoogleCalendarConnection). El refetch al volver a la pestaña
// (refetchOnWindowFocus del queryClient) es lo que actualiza la sección
// cuando la persona termina la autorización en la pestaña de Google y vuelve.
export function useGoogleCalendarConnection(branchId: string) {
  return useQuery({
    queryKey: branchKeys.googleCalendar(branchId),
    queryFn: ({ signal }) => getGoogleCalendarConnection(branchId, signal),
  });
}
