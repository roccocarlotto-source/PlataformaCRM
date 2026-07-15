import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createInvitation, revokeInvitation } from "./api";
import { invitationKeys } from "./queries";
import type { CreateInvitationInput } from "./types";

// Invalidación selectiva pura — solo invitationKeys.lists(). Nunca
// userKeys: crear/revocar una Invitation no toca la tabla users (confirmado
// en invitation.repository.ts — createInvitationRepo/revokeInvitationConditional
// tocan exclusivamente db.invitation). El caso donde SÍ se crea un User
// (aceptar) ocurre en una sesión de navegador distinta, sin cache
// compartido con esta — ver AcceptInvitationPage, no hay invalidación de
// administración que ejecutar desde ahí.

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) => createInvitation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.lists() });
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.lists() });
    },
  });
}
