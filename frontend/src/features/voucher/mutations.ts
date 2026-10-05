import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createVoucher, redeemVoucher, sendVoucherWhatsapp } from "./api";
import { conversationKeys } from "../conversation/queries";
import { voucherKeys } from "./queries";
import type { CreateVoucherInput } from "./types";

// El canje invalida las listas de cupones (el estado pasa a canjeado).
export function useRedeemVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => redeemVoucher(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: voucherKeys.all }),
  });
}

export function useCreateVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVoucherInput) => createVoucher(input),
    onSuccess: (voucher) =>
      queryClient.invalidateQueries({ queryKey: voucherKeys.byContact(voucher.contactId) }),
  });
}

// Lo mandado queda en el hilo de la conversación: se invalidan las
// conversaciones para que el detalle lo muestre.
export function useSendVoucherWhatsapp(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendVoucherWhatsapp(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: voucherKeys.whatsapp(id) });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}
