import { useQuery } from "@tanstack/react-query";
import { listBranches } from "./api";
import type { BranchListQuery } from "./types";

// Misma forma jerárquica que userKeys/companyKeys. Sin details()/detail():
// no hay consumidor de GET /api/branches/:id (ver api.ts).
export const branchKeys = {
  all: ["branches"] as const,
  lists: () => [...branchKeys.all, "list"] as const,
  list: (query: BranchListQuery) => [...branchKeys.lists(), query] as const,
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
