import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimQrCode, createDigitalQrCode, deleteQrCode, updateQrCode } from "./api";
import { qrKeys } from "./queries";
import type { ClaimQrInput, CreateDigitalQrInput, UpdateQrInput } from "./types";

// Invalidación mínima, mismo patrón que company/apiKey: cada mutación
// invalida solo `lists()` — no hay `detail` porque no existe el endpoint.
// Nunca queryClient.clear() acá (exclusivo de la frontera de identidad de
// AuthContext).
//
// Ninguna de estas respuestas trae un secreto (a diferencia de
// useCreateApiKey): el QrCode que devuelve el 201 es la misma proyección
// pública que el listado, así que el hallazgo S2-4 (reset() del
// MutationCache al cerrar el diálogo) no aplica acá.

export function useCreateDigitalQrCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDigitalQrInput) => createDigitalQrCode(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.lists() });
    },
  });
}

export function useClaimQrCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClaimQrInput) => claimQrCode(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.lists() });
    },
  });
}

export function useUpdateQrCode(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateQrInput) => updateQrCode(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.lists() });
    },
  });
}

export function useDeleteQrCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQrCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.lists() });
    },
  });
}
