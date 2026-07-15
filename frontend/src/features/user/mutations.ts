import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteUser, updateUser } from "./api";
import { userKeys } from "./queries";
import type { UpdateUserInput } from "./types";

// Invalidación selectiva pura — mismo criterio que company/contact/pipeline/
// stage/opportunity/activity: solo userKeys.lists() (no hay detail(), ver
// queries.ts). No se invalida ningún cache de Opportunity/Activity: sus
// ownerId/authorId/assigneeId no cambian por esto, solo puede cambiar si esa
// misma Opportunity/Activity se actualiza — sin efecto lateral real
// demostrado que justifique tocar esos caches desde acá.
export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => updateUser(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
