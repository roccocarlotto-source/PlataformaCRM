import { describe, expect, it } from "vitest";
import { paymentTotals } from "./totals";

const OPPORTUNITY = { amount: "25000.00", currency: "USD" };

describe("paymentTotals", () => {
  it("sin pagos: pagado 0 y saldo igual al monto", () => {
    expect(paymentTotals([], OPPORTUNITY)).toEqual({
      paid: "0.00",
      balance: "25000.00",
      excludedCount: 0,
    });
  });

  it("suma en centavos, sin restos de float", () => {
    const payments = [
      { amount: "0.10", currency: "USD" },
      { amount: "0.20", currency: "USD" },
      { amount: "5000.00", currency: "USD" },
    ];
    expect(paymentTotals(payments, OPPORTUNITY)).toEqual({
      paid: "5000.30",
      balance: "19999.70",
      excludedCount: 0,
    });
  });

  it("los pagos en otra moneda no se suman y se cuentan aparte", () => {
    const payments = [
      { amount: "5000.00", currency: "USD" },
      { amount: "200000.00", currency: "UYU" },
      { amount: "1000.00", currency: "UYU" },
    ];
    expect(paymentTotals(payments, OPPORTUNITY)).toEqual({
      paid: "5000.00",
      balance: "20000.00",
      excludedCount: 2,
    });
  });

  it("cobrado de más: el saldo queda negativo", () => {
    expect(paymentTotals([{ amount: "26000.00", currency: "USD" }], OPPORTUNITY)).toEqual({
      paid: "26000.00",
      balance: "-1000.00",
      excludedCount: 0,
    });
  });
});
