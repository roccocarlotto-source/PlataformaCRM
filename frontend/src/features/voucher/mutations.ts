import { useMutation } from "@tanstack/react-query";
import { redeemVoucher } from "./api";

// Sin cache que actualizar: ninguna pantalla lista cupones todavía.
export function useRedeemVoucher() {
  return useMutation({ mutationFn: (id: string) => redeemVoucher(id) });
}
