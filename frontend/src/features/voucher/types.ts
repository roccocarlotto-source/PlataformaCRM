// Espejo a mano de la fila DiscountVoucher que devuelve
// POST /api/vouchers/:id/redeem (ítem 176, voucher.controller.ts): el cupón
// ya CONSUMED. Solo los campos que la pantalla usa.
export interface RedeemedVoucher {
  id: string;
  label: string;
  status: "ACTIVE" | "CONSUMED";
  expiresAt: string;
  consumedAt: string | null;
}
