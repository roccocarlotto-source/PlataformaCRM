import { todayIsoDate } from "../opportunity/boardMove";
import type { CreatePaymentInput, Payment, PaymentMethod } from "./types";

// ---------------------------------------------------------------------------
// Estado y validación del formulario inline de pagos (§43). Funciones puras,
// sin React, mismo criterio que quote/quoteForm.ts.
// ---------------------------------------------------------------------------

export interface PaymentFormValues {
  // Canónico de CurrencyInput: "5000.5", "" si está vacío.
  amount: string;
  method: PaymentMethod;
  // "YYYY-MM-DD" del input type="date".
  paidAt: string;
}

// Un pago nuevo: la fecha arranca en HOY según el reloj local (todayIsoDate,
// no toISOString, que de noche en Uruguay ya es mañana). El backend no tiene
// default: la precarga es del formulario.
export function formValuesForNew(now: Date = new Date()): PaymentFormValues {
  return { amount: "", method: "CASH", paidAt: todayIsoDate(now) };
}

export function formValuesForEdit(payment: Payment): PaymentFormValues {
  return {
    // Number() para el canónico sin ceros de relleno ("1500.00" -> "1500").
    amount: String(Number(payment.amount)),
    method: payment.method,
    // Lectura ISO -> slice(0, 10): nunca new Date(iso) + formato local.
    paidAt: payment.paidAt.slice(0, 10),
  };
}

// El mismo piso que el backend (payment.controller.ts): 0.01, porque
// Decimal(14, 2) redondearía algo menor a 0.00 y el CHECK lo rechaza.
export function validatePaymentForm(values: PaymentFormValues): string | null {
  const amount = Number(values.amount);
  if (values.amount === "" || !Number.isFinite(amount) || amount < 0.01) {
    return "Ingresá un monto mayor a 0";
  }
  if (!values.paidAt) {
    return "Ingresá la fecha del pago";
  }
  return null;
}

export function toPaymentInput(
  values: PaymentFormValues,
): Omit<CreatePaymentInput, "opportunityId"> {
  return { amount: Number(values.amount), method: values.method, paidAt: values.paidAt };
}
