import { describe, expect, it } from "vitest";
import { formatAmount, formatAmountTotals } from "./format";

// ---------------------------------------------------------------------------
// Los montos de oportunidades, del inicio y del stock, con el formato de todo
// el sistema (UX-09 de docs-privados/auditoria-2026-10-21/informe-etapa-2.md,
// local): antes se leían "23000.00 USD".
// ---------------------------------------------------------------------------

describe("formatAmount", () => {
  it("miles con punto; los centavos solo si existen, con coma", () => {
    expect(formatAmount("23000.00", "USD")).toBe("23.000 USD");
    expect(formatAmount("1234567", "UYU")).toBe("1.234.567 UYU");
    expect(formatAmount("20000.5", "USD")).toBe("20.000,50 USD");
    expect(formatAmount("0", "USD")).toBe("0 USD");
  });

  it("un monto con centavos los muestra con coma y no los redondea", () => {
    expect(formatAmount("5200.50", "UYU")).toBe("5.200,50 UYU");
    expect(formatAmount("5200.5", "UYU")).toBe("5.200,50 UYU");
    expect(formatAmount("0.99", "USD")).toBe("0,99 USD");
    expect(formatAmount("1999.01", "USD")).toBe("1.999,01 USD");
  });

  it("un negativo lleva el signo menos tipográfico", () => {
    expect(formatAmount("-500.00", "USD")).toBe("−500 USD");
  });
});

describe("formatAmountTotals", () => {
  it("un total por moneda, en el orden en que aparecen", () => {
    expect(
      formatAmountTotals([
        { amount: "1500.00", currency: "USD" },
        { amount: "300.00", currency: "UYU" },
        { amount: "2500.00", currency: "USD" },
      ]),
    ).toBe("4.000 USD · 300 UYU");
  });

  it("suma en centavos: 0,10 + 0,20 es 0,30 exacto", () => {
    expect(
      formatAmountTotals([
        { amount: "0.10", currency: "USD" },
        { amount: "0.20", currency: "USD" },
      ]),
    ).toBe("0,30 USD");
  });

  it("sin nada que sumar, —", () => {
    expect(formatAmountTotals([])).toBe("—");
  });
});
