import { formatMoney } from "../../design-system/currencyFormat";
import { formatDate } from "../opportunity/format";
import { PAYMENT_METHOD_LABEL } from "./labels";
import type { FotoDePago, PaymentChange } from "./types";

// ---------------------------------------------------------------------------
// El texto de cada fila del historial de pagos (PR-17b). Función pura, sin
// React: qué hizo quién, y en una corrección, cada campo que cambió con su
// valor de antes y el de ahora.
// ---------------------------------------------------------------------------

function resumen(foto: FotoDePago): string {
  return `${formatMoney(foto.amount, foto.currency)} (${metodo(foto.method)}, ${formatDate(foto.paidAt)})`;
}

function metodo(valor: string): string {
  return PAYMENT_METHOD_LABEL[valor as keyof typeof PAYMENT_METHOD_LABEL] ?? valor;
}

export function describirCambio(
  change: Pick<PaymentChange, "action" | "before" | "after">,
): string {
  const { action, before, after } = change;
  if (action === "CREATED" && after) {
    return `Registró un pago de ${resumen(after)}`;
  }
  if (action === "DELETED" && before) {
    return `Eliminó un pago de ${resumen(before)}`;
  }
  if (action === "UPDATED" && before && after) {
    const cambios: string[] = [];
    if (before.amount !== after.amount) {
      cambios.push(
        `monto ${formatMoney(before.amount, before.currency)} → ${formatMoney(after.amount, after.currency)}`,
      );
    }
    if (before.method !== after.method) {
      cambios.push(`método ${metodo(before.method)} → ${metodo(after.method)}`);
    }
    if (before.paidAt !== after.paidAt) {
      cambios.push(`fecha ${formatDate(before.paidAt)} → ${formatDate(after.paidAt)}`);
    }
    return `Corrigió un pago: ${cambios.join("; ")}`;
  }
  // Una fila que no cumple el CHECK de la base no debería existir; si
  // aparece, se muestra algo en vez de romper la tarjeta.
  return "Cambió un pago";
}
