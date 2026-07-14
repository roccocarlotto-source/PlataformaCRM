import { useQuery } from "@tanstack/react-query";
import { listUsers } from "./api";
import type { UserListQuery } from "./types";

// Sin details()/detail(): no existe GET /api/users/:id (ver api.ts), no se
// agrega una key para una capacidad que el backend no tiene.
export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (query: UserListQuery) => [...userKeys.lists(), query] as const,
};

// enabled es explícito y externo (no un default true escondido): tanto
// UserSelect (siempre montado detrás de AdminRoute) como la resolución de
// Owner en OpportunityListPage (gateada por rol, ver
// opportunity/relationResolution.ts) dependen de poder desactivar este
// fetch por completo para USER, no solo ignorar su resultado.
export function useUsers(query: UserListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: userKeys.list(query),
    queryFn: ({ signal }) => listUsers(query, signal),
    enabled: options?.enabled,
  });
}
