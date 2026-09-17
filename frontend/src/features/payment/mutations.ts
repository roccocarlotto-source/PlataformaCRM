import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPayment, deletePayment, updatePayment } from "./api";
import { paymentKeys } from "./queries";
import type { CreatePaymentInput, UpdatePaymentInput } from "./types";

// Toda escritura invalida el historial de la oportunidad: el orden (por fecha
// de cobro) y el total dependen de la lista entera. Un pago no escribe sobre
// la oportunidad (es informativo, §43), así que opportunityKeys no se toca.

export function useCreatePayment(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreatePaymentInput, "opportunityId">) =>
      createPayment({ ...input, opportunityId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: paymentKeys.byOpportunity(opportunityId) }),
  });
}

export function useUpdatePayment(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePaymentInput }) =>
      updatePayment(id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: paymentKeys.byOpportunity(opportunityId) }),
  });
}

// onSettled y no onSuccess: un 404 (alguien lo borró mientras la pantalla
// estaba abierta) también deja la lista vieja, y refrescar la corrige.
export function useDeletePayment(opportunityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePayment(id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: paymentKeys.byOpportunity(opportunityId) }),
  });
}
