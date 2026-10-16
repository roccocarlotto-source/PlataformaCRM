import { queryOptions, useQuery } from "@tanstack/react-query";
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
export function usersQuery(query: UserListQuery) {
  return queryOptions({
    queryKey: userKeys.list(query),
    queryFn: ({ signal }) => listUsers(query, signal),
  });
}

export function useUsers(query: UserListQuery, options?: { enabled?: boolean }) {
  return useQuery({ ...usersQuery(query), enabled: options?.enabled });
}

// La lista de los selectores de usuario (UserSelect) y de la resolución del
// asignado (useOwnerNames): una sola clave, así la comparten, y la ficha del
// contacto la precarga. Hasta 100 activos, por nombre (ver UserSelect).
export const USUARIOS_PARA_ELEGIR: UserListQuery = {
  pageSize: 100,
  isActive: true,
  sortBy: "fullName",
  sortOrder: "asc",
};
