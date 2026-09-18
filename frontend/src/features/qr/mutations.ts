import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimQrCode, createDigitalQrCode, deleteQrCode, updateQrCode } from "./api";
import { qrKeys } from "./queries";
import type { ClaimQrInput, CreateDigitalQrInput, UpdateQrInput } from "./types";

// Invalidación mínima, mismo patrón que company/apiKey: cada mutación
// invalida `all` — no hay `detail` porque no existe el endpoint.
//
// `all` Y NO `lists()` DESDE §54: crear, editar o borrar un QR cambia también
// cuál es el próximo N° libre de esa sucursal, y ese sugerido es otra query
// (qrKeys.nextDisplayNumber). Invalidar solo el listado dejaría al formulario
// proponiendo un número que el QR recién creado ya se llevó — se rechazaría
// con el 409 del backend, correcto pero desconcertante. `all` es el prefijo
// común de las dos y sigue siendo exactamente lo que este cambio afecta.
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
      queryClient.invalidateQueries({ queryKey: qrKeys.all });
    },
  });
}

export function useClaimQrCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClaimQrInput) => claimQrCode(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.all });
    },
  });
}

export function useUpdateQrCode(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateQrInput) => updateQrCode(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.all });
    },
  });
}

export function useDeleteQrCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQrCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qrKeys.all });
    },
  });
}
