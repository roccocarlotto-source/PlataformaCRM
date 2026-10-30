import { describe, expect, it } from "vitest";
import { describirCambio } from "./historial";

const original = { amount: "5000.00", currency: "USD", method: "TRANSFER", paidAt: "2026-09-16" };

describe("describirCambio (historial de pagos, PR-17b)", () => {
  it("alta y borrado: el pago entero, con método y fecha", () => {
    expect(describirCambio({ action: "CREATED", before: null, after: original })).toMatch(
      /^Registró un pago de .*5\.000.*USD.*\(Transferencia, .*2026\)$/,
    );
    expect(describirCambio({ action: "DELETED", before: original, after: null })).toMatch(
      /^Eliminó un pago de .*5\.000.*USD.*\(Transferencia, .*2026\)$/,
    );
  });

  it("corrección: solo lo que cambió, con el valor de antes y el de ahora", () => {
    const texto = describirCambio({
      action: "UPDATED",
      before: original,
      after: { ...original, amount: "4500.00", method: "CASH" },
    });
    expect(texto).toMatch(
      /^Corrigió un pago: monto .*5\.000.* → .*4\.500.*; método Transferencia → Efectivo$/,
    );
    expect(texto).not.toMatch(/fecha/);
  });

  it("una fila que no cumple la forma esperada no rompe", () => {
    expect(describirCambio({ action: "UPDATED", before: null, after: original })).toBe(
      "Cambió un pago",
    );
  });
});
