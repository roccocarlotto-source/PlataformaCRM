import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiKey, revokeApiKey } from "./api";
import { apiKeyKeys } from "./queries";
import type { CreateApiKeyInput } from "./types";

// Invalidación mínima, mismo patrón que Source/Company/Contact. Solo `lists()`
// en las dos: no hay `detail` que invalidar porque no existe el endpoint.

// EL RESULTADO DE ESTA MUTACIÓN TRAE EL SECRETO. mutateAsync devuelve
// CreatedApiKey, y el llamador es responsable de que ese valor no sobreviva más
// allá del modal que lo muestra: no se guarda en cache de TanStack Query (no hay
// queryKey donde caiga), no se persiste, y la lista se refresca por invalidación
// —que trae la proyección pública, sin `key`— en vez de por escritura optimista
// del objeto creado.
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => createApiKey(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}
