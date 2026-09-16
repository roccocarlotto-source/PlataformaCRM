import { describe, expect, it } from "vitest";
import { makeQuote } from "../../test/quoteFixtures";
import { formatMoney, quoteTotal, toCents, vehicleLabel } from "./format";

describe("quote/format", () => {
  it("toCents: exacto para importes de hasta dos decimales, negativos incluidos", () => {
    expect(toCents("25000.00")).toBe(2_500_000);
    expect(toCents("0.10")).toBe(10);
    expect(toCents("-1500.50")).toBe(-150_050);
  });

  it("quoteTotal: precio + accesorios − descuentos, sumado en centavos", () => {
    const quote = makeQuote({
      amount: "25000.00",
      lines: [
        { description: "Polarizado", amount: "350.10" },
        { description: "Alfombras", amount: "0.20" },
        { description: "Descuento contado", amount: "-1000.00" },
      ],
    });
    expect(quoteTotal(quote)).toBe("24350.30");
    expect(quoteTotal(makeQuote({ amount: "100.00", lines: [] }))).toBe("100.00");
  });

  it("quoteTotal: un descuento mayor que el precio da un total negativo, sin perder el signo", () => {
    expect(
      quoteTotal(makeQuote({ amount: "10.00", lines: [{ description: "x", amount: "-10.05" }] })),
    ).toBe("-0.05");
  });

  it("formatMoney: formato uruguayo con la moneda, y el signo menos tipográfico en negativos", () => {
    expect(formatMoney("24150.5", "USD")).toBe("24.150,50 USD");
    expect(formatMoney("-500.00", "UYU")).toBe("−500,00 UYU");
    expect(formatMoney("0", "USD")).toBe("0,00 USD");
  });

  it("vehicleLabel: marca, modelo, versión y año, con el código interno; sin versión no deja huecos", () => {
    expect(
      vehicleLabel({
        id: "v1",
        internalCode: "STK-000123",
        make: "Toyota",
        model: "Corolla",
        trim: "XEI",
        year: 2022,
      }),
    ).toBe("Toyota Corolla XEI 2022 · STK-000123");
    expect(
      vehicleLabel({
        id: "v2",
        internalCode: "STK-000124",
        make: "Ford",
        model: "Ranger",
        trim: null,
        year: 2021,
      }),
    ).toBe("Ford Ranger 2021 · STK-000124");
  });
});
