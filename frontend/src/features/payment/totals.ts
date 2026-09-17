import { centsToCanonical, toCents } from "../quote/format";
import type { Opportunity } from "../opportunity/types";
import type { Payment } from "./types";

// ---------------------------------------------------------------------------
// "Pagado: X de Y · Saldo: Z" de la tarjeta de pagos (§43). Función pura, sin
// React (totals.test.ts). Se calcula en el cliente sobre la lista ya cargada,
// sin endpoint de agregación.
//
// SOLO SUMA LOS PAGOS EN LA MONEDA ACTUAL DE LA OPORTUNIDAD. Payment.currency
// es una foto: si la oportunidad cambió de moneda después de cobrar, esos
// pagos quedan en la otra moneda y no se suman — no se inventa una conversión
// de cambio, igual que la suma agrupada por moneda de opportunity/format.ts.
// Se cuentan aparte para que la tarjeta avise que quedaron afuera.
//
// En centavos enteros, mismo motivo que quoteTotal: sumar floats dejaría
// restos. El saldo puede dar negativo (se cobró de más, o el monto de la
// oportunidad bajó): se muestra tal cual, es información.
// ---------------------------------------------------------------------------

export interface PaymentTotals {
  // Strings canónicos con dos decimales ("12500.00"), en opportunity.currency.
  paid: string;
  balance: string;
  // Pagos con otra moneda, fuera de paid/balance.
  excludedCount: number;
}

export function paymentTotals(
  payments: readonly Pick<Payment, "amount" | "currency">[],
  opportunity: Pick<Opportunity, "amount" | "currency">,
): PaymentTotals {
  let paidCents = 0;
  let excludedCount = 0;
  for (const payment of payments) {
    if (payment.currency === opportunity.currency) {
      paidCents += toCents(payment.amount);
    } else {
      excludedCount += 1;
    }
  }
  return {
    paid: centsToCanonical(paidCents),
    balance: centsToCanonical(toCents(opportunity.amount) - paidCents),
    excludedCount,
  };
}
