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

// "Crear cupón" a mano (discountVoucherManual.service.ts del backend): el cupón
// como lo ve la pantalla, con el estado ya derivado (vencido no se guarda) y
// el link público que codifica su QR.
export type VoucherStatus = "ACTIVE" | "CONSUMED" | "EXPIRED";

export interface Voucher {
  id: string;
  label: string;
  status: VoucherStatus;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  contactId: string;
  opportunityId: string | null;
  branchId: string | null;
  origin: "AUTOMATION" | "MANUAL";
  publicUrl: string;
}

export interface CreateVoucherInput {
  contactId?: string;
  opportunityId?: string;
  label: string;
  expiresInDays: number;
  branchId: string;
}

// GET /api/vouchers/:id/whatsapp: si se puede mandar ahora, o por qué no.
export interface VoucherWhatsappStatus {
  disponible: boolean;
  motivo: string | null;
  conversationId: string | null;
}

export interface VoucherWhatsappResult {
  conversationId: string;
  deliveryStatus: "PENDING" | "SENT" | "FAILED" | "DELIVERED" | "READ" | null;
  deliveryError: string | null;
}
