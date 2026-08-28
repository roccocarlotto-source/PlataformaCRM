import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiKey, revokeApiKey } from "./api";
import { apiKeyKeys } from "./queries";
import type { CreateApiKeyInput } from "./types";

// Invalidación mínima, mismo patrón que Source/Company/Contact. Solo `lists()`
// en las dos: no hay `detail` que invalidar porque no existe el endpoint.

// EL RESULTADO DE ESTA MUTACIÓN TRAE EL SECRETO, y el llamador es responsable
// de que no sobreviva al modal que lo muestra.
//
// NO CAE EN NINGÚN QueryCache: no hay queryKey donde caiga, no se persiste, y
// la lista se refresca por invalidación —que trae la proyección pública, sin
// `key`— en vez de por escritura optimista del objeto creado.
//
// PERO SÍ QUEDA EN EL MutationCache, que es lo que este comentario afirmaba de
// más hasta el hallazgo S2-4 de docs/review-fase2-2026-08-28.md: useMutation
// cachea su resultado como `.data`, con el secreto adentro, y lo mantiene vivo
// después de cerrado el modal hasta que el gcTime por defecto lo recoja. Lo que
// lo limpia es un `reset()` EXPLÍCITO del llamador al cerrar el cuadro — ver
// ApiKeyListPage.tsx. No es automático y no puede resolverse acá adentro: este
// hook no sabe cuándo el consumidor terminó de mostrarlo.
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
