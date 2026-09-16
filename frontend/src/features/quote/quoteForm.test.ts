import { describe, expect, it } from "vitest";
import { makeQuote } from "../../test/quoteFixtures";
import {
  formValuesForEdit,
  formValuesForNew,
  toQuoteInput,
  validateQuoteForm,
  type QuoteFormValues,
} from "./quoteForm";

const conLineas = makeQuote({
  amount: "25000.00",
  currency: "UYU",
  validUntil: "2026-09-30T00:00:00.000Z",
  lines: [
    { description: "Polarizado", amount: "350.00" },
    { description: "Descuento contado", amount: "-1000.50" },
  ],
});

describe("quote/quoteForm", () => {
  it("editar: toma todo lo guardado; los descuentos vuelven como importe positivo + tipo", () => {
    expect(formValuesForEdit(conLineas)).toEqual({
      amount: "25000",
      currency: "UYU",
      validUntil: "2026-09-30",
      lines: [
        { description: "Polarizado", kind: "extra", amount: "350" },
        { description: "Descuento contado", kind: "discount", amount: "1000.5" },
      ],
    });
  });

  it("nueva con una activa: arranca de la activa, con la validez vacía", () => {
    const values = formValuesForNew(conLineas, { amount: "1.00", currency: "USD" });
    expect(values.amount).toBe("25000");
    expect(values.currency).toBe("UYU");
    expect(values.validUntil).toBe("");
    expect(values.lines).toHaveLength(2);
  });

  it("nueva sin activa: arranca del monto y la moneda de la oportunidad; un monto 0 queda vacío", () => {
    expect(formValuesForNew(null, { amount: "18500.00", currency: "USD" })).toEqual({
      amount: "18500",
      currency: "USD",
      validUntil: "",
      lines: [],
    });
    expect(formValuesForNew(null, { amount: "0.00", currency: "UYU" }).amount).toBe("");
  });

  it("validación: exige el precio, y descripción e importe en cada línea", () => {
    const base: QuoteFormValues = { amount: "100", currency: "USD", validUntil: "", lines: [] };
    expect(validateQuoteForm(base)).toBeNull();
    expect(validateQuoteForm({ ...base, amount: "" })).toMatch(/precio ofertado/);
    expect(
      validateQuoteForm({
        ...base,
        lines: [{ description: "  ", kind: "extra", amount: "10" }],
      }),
    ).toMatch(/línea 1 necesita una descripción/);
    expect(
      validateQuoteForm({
        ...base,
        lines: [
          { description: "Ok", kind: "extra", amount: "10" },
          { description: "Sin importe", kind: "discount", amount: "" },
        ],
      }),
    ).toMatch(/línea 2 necesita un importe/);
  });

  it("toQuoteInput: números, descuentos con signo negativo, y validez vacía como null explícito", () => {
    expect(
      toQuoteInput({
        amount: "24500.5",
        currency: "USD",
        validUntil: "",
        lines: [
          { description: " Polarizado ", kind: "extra", amount: "350" },
          { description: "Descuento", kind: "discount", amount: "1000" },
        ],
      }),
    ).toEqual({
      amount: 24500.5,
      currency: "USD",
      validUntil: null,
      lines: [
        { description: "Polarizado", amount: 350 },
        { description: "Descuento", amount: -1000 },
      ],
    });
    expect(
      toQuoteInput({ amount: "1", currency: "USD", validUntil: "2026-10-01", lines: [] })
        .validUntil,
    ).toBe("2026-10-01");
  });
});
