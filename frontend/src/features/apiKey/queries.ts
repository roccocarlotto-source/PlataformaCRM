import { useQuery } from "@tanstack/react-query";
import { listApiKeys } from "./api";
import type { ApiKeyListQuery } from "./types";

// Misma forma jerárquica que sourceKeys/companyKeys/contactKeys.
//
// SIN `detail`, deliberadamente: no existe GET /api/api-keys/:id en el backend
// (apiKey.routes.ts tiene GET del listado, POST y DELETE, nada más). Es el mismo
// criterio que userKeys e invitationKeys, que tampoco lo declaran por la misma
// razón — una key para una query que no puede existir sería una invitación a
// escribirla.
export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (query: ApiKeyListQuery) => [...apiKeyKeys.lists(), query] as const,
};

export function useApiKeys(query: ApiKeyListQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: apiKeyKeys.list(query),
    queryFn: ({ signal }) => listApiKeys(query, signal),
    enabled: options?.enabled,
  });
}
