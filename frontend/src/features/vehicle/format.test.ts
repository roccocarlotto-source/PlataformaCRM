import { describe, expect, it } from "vitest";
import { makeVehicle } from "../../test/vehicleFixtures";
import { ETIQUETA_DE_MONEDA_LOCAL, monedaLocalDe, priceCell } from "./format";

describe("priceCell", () => {
  it("USD si lo tiene; 'Consultar precio' manda; '—' sin ningún precio", () => {
    expect(priceCell(makeVehicle({ priceListUsd: "25000.00", priceListLocal: "1025000.00" }))).toBe(
      "25.000 USD",
    );
    expect(priceCell(makeVehicle({ priceListUsd: "25000.00", priceOnRequest: true }))).toBe(
      "Consultar precio",
    );
    expect(priceCell(makeVehicle({ priceListUsd: null, priceListLocal: null }))).toBe("—");
  });

  it("solo en moneda local: el precio local, con la moneda o la etiqueta genérica", () => {
    const soloPesos = makeVehicle({ priceListUsd: null, priceListLocal: "520000.00" });
    expect(priceCell(soloPesos, "UYU")).toBe("520.000 UYU");
    expect(priceCell(soloPesos)).toBe(`520.000 ${ETIQUETA_DE_MONEDA_LOCAL}`);
    expect(priceCell(soloPesos, null)).toBe(`520.000 ${ETIQUETA_DE_MONEDA_LOCAL}`);
  });
});

describe("monedaLocalDe", () => {
  it("la del par cotizado; si no hay cotización, la moneda distinta de USD; si no, null", () => {
    expect(
      monedaLocalDe({
        preferredCurrency: "USD",
        alternateCurrency: null,
        exchangeRates: [{ targetCurrency: "UYU", rate: "41", rateDate: "2026-10-17" }],
      }),
    ).toBe("UYU");
    expect(
      monedaLocalDe({ preferredCurrency: "USD", alternateCurrency: "ARS", exchangeRates: [] }),
    ).toBe("ARS");
    expect(
      monedaLocalDe({ preferredCurrency: "USD", alternateCurrency: null, exchangeRates: [] }),
    ).toBeNull();
    expect(monedaLocalDe(undefined)).toBeNull();
  });
});
