import type { PaymentMethod } from "./types";

// Método de pago en español, mismo criterio que QUOTE_STATUS_LABEL: el enum
// queda en inglés en el contrato, la UI no. El orden de las claves es el del
// <select>.
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  CHECK: "Cheque",
  OTHER: "Otro",
};
