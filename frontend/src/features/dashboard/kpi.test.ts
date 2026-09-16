import { describe, expect, it } from "vitest";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import type { OpportunityRevenueGranularity } from "../opportunity/types";
import { buildKpiCards, kpiLabels, percentDelta, winRate } from "./kpi";

function cardsByKey(summary = makeDashboardSummary()) {
  return new Map(buildKpiCards(summary).map((card) => [card.key, card]));
}

describe("percentDelta", () => {
  it("variación relativa redondeada, con signo", () => {
    expect(percentDelta(2000, 1000)).toBe(100);
    expect(percentDelta(900, 1000)).toBe(-10);
    expect(percentDelta(1000, 1000)).toBe(0);
    // 0.5% redondea a 1.
    expect(percentDelta(1005, 1000)).toBe(1);
  });

  it("sin base (período anterior en 0) → null, nunca Infinity ni NaN", () => {
    expect(percentDelta(500, 0)).toBeNull();
    expect(percentDelta(0, 0)).toBeNull();
  });
});

describe("winRate", () => {
  it("WON / (WON + LOST) en % redondeado", () => {
    expect(winRate(2, 2)).toBe(50);
    expect(winRate(1, 2)).toBe(33);
    expect(winRate(3, 0)).toBe(100);
    expect(winRate(0, 4)).toBe(0);
  });

  it("nada cerrado → null (no se divide por cero)", () => {
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("buildKpiCards", () => {
  it("devuelve las 3 cards en el orden del mockup", () => {
    expect(buildKpiCards(makeDashboardSummary()).map((card) => card.key)).toEqual([
      "created",
      "won",
      "winRate",
    ]);
  });

  it("creadas: el número grande es createdThisPeriod.count, no las abiertas de ahora", () => {
    const card = cardsByKey(
      makeDashboardSummary({
        // openCount ya no alimenta ninguna card desde el §35 (openValue
        // tampoco, desde el §36).
        openCount: 99,
        createdThisPeriod: { count: 5, value: "2000.00" },
        createdLastPeriod: { count: 3, value: "1000.00" },
      }),
    ).get("created");
    expect(card?.value).toBe("5");
    expect(card?.delta).toEqual({ direction: "up", text: "+2 vs. mes anterior" });
  });

  it("creadas: menos que el período anterior baja; igual cantidad es neutral", () => {
    const menos = cardsByKey(
      makeDashboardSummary({
        createdThisPeriod: { count: 1, value: "0.00" },
        createdLastPeriod: { count: 4, value: "0.00" },
      }),
    ).get("created");
    expect(menos?.delta).toEqual({ direction: "down", text: "-3 vs. mes anterior" });

    const igual = cardsByKey(
      makeDashboardSummary({
        createdThisPeriod: { count: 2, value: "0.00" },
        createdLastPeriod: { count: 2, value: "0.00" },
      }),
    ).get("created");
    expect(igual?.delta).toEqual({ direction: "neutral", text: "0 vs. mes anterior" });
  });

  it("ganado: monto en la moneda y variación relativa contra el período anterior, negativa en rojo", () => {
    const card = cardsByKey(
      makeDashboardSummary({
        currency: "UYU",
        wonThisPeriod: { count: 1, value: "750.00" },
        wonLastPeriod: { count: 2, value: "1000.00" },
      }),
    ).get("won");
    expect(card?.value).toBe("750.00 UYU");
    expect(card?.delta).toEqual({ direction: "down", text: "-25% vs. mes anterior" });
  });

  it("tasa de cierre: WON/(WON+LOST) del período, variación en puntos porcentuales", () => {
    // Este período 2 WON / 2 LOST = 50%; el anterior 1 WON / 1 LOST = 50%.
    const igual = cardsByKey().get("winRate");
    expect(igual?.value).toBe("50%");
    expect(igual?.delta).toEqual({ direction: "neutral", text: "0 pts vs. mes anterior" });

    const sube = cardsByKey(
      makeDashboardSummary({
        wonThisPeriod: { count: 3, value: "0.00" },
        lostCountThisPeriod: 1,
        wonLastPeriod: { count: 1, value: "0.00" },
        lostCountLastPeriod: 3,
      }),
    ).get("winRate");
    expect(sube?.value).toBe("75%");
    expect(sube?.delta).toEqual({ direction: "up", text: "+50 pts vs. mes anterior" });
  });

  it("tasa de cierre: sin nada cerrado este período el valor es un guion; sin nada cerrado el anterior, la variación es neutral", () => {
    const sinEstePeriodo = cardsByKey(
      makeDashboardSummary({ wonThisPeriod: { count: 0, value: "0.00" }, lostCountThisPeriod: 0 }),
    ).get("winRate");
    expect(sinEstePeriodo?.value).toBe("—");
    expect(sinEstePeriodo?.delta.direction).toBe("neutral");

    const sinAnterior = cardsByKey(
      makeDashboardSummary({ wonLastPeriod: { count: 0, value: "0.00" }, lostCountLastPeriod: 0 }),
    ).get("winRate");
    expect(sinAnterior?.value).toBe("50%");
    expect(sinAnterior?.delta.direction).toBe("neutral");
    expect(sinAnterior?.delta.text).toMatch(/^—/);
  });
});

// ---------------------------------------------------------------------------
// §35: las nueve combinaciones de rótulo y comparación. La granularidad sale
// del propio resumen (el eco del backend), no de un argumento aparte: los
// rótulos describen SIEMPRE la ventana de los números que acompañan. Desde el
// §36 las tres cards del resumen son las tres que siguen al selector: ya no
// hay ninguna que se quede en mensual.
// ---------------------------------------------------------------------------

describe("buildKpiCards — rótulos por granularidad (§35)", () => {
  const ESPERADO: Record<
    OpportunityRevenueGranularity,
    { created: string; won: string; winRate: string; comparison: string; previous: string }
  > = {
    month: {
      created: "Oportunidades creadas este mes",
      won: "Ganado este mes",
      winRate: "Tasa de cierre del mes",
      comparison: "vs. mes anterior",
      previous: "el mes anterior",
    },
    week: {
      created: "Oportunidades creadas esta semana",
      won: "Ganado esta semana",
      winRate: "Tasa de cierre de la semana",
      comparison: "vs. semana anterior",
      previous: "la semana anterior",
    },
    day: {
      created: "Oportunidades creadas hoy",
      won: "Ganado hoy",
      winRate: "Tasa de cierre del día",
      comparison: "vs. ayer",
      previous: "ayer",
    },
  };

  for (const granularity of ["month", "week", "day"] as const) {
    const esperado = ESPERADO[granularity];

    it(`${granularity}: rótulo y comparación de las tres cards que siguen al selector`, () => {
      const cards = cardsByKey(makeDashboardSummary({ granularity }));

      expect(cards.get("created")?.label).toBe(esperado.created);
      expect(cards.get("created")?.delta.text).toBe(`+2 ${esperado.comparison}`);

      expect(cards.get("won")?.label).toBe(esperado.won);
      expect(cards.get("won")?.delta.text).toBe(`+100% ${esperado.comparison}`);

      expect(cards.get("winRate")?.label).toBe(esperado.winRate);
      expect(cards.get("winRate")?.delta.text).toBe(`0 pts ${esperado.comparison}`);
    });

    it(`${granularity}: el "sin base de comparación" también nombra la ventana anterior`, () => {
      const cards = cardsByKey(
        makeDashboardSummary({
          granularity,
          wonLastPeriod: { count: 0, value: "0.00" },
          lostCountLastPeriod: 0,
        }),
      );
      expect(cards.get("won")?.delta.text).toBe(`— sin base de comparación ${esperado.previous}`);
      expect(cards.get("winRate")?.delta.text).toBe(
        `— sin base de comparación ${esperado.previous}`,
      );
    });

    it(`${granularity}: kpiLabels devuelve los mismos rótulos que las cards, en el mismo orden`, () => {
      const cards = buildKpiCards(makeDashboardSummary({ granularity }));
      expect(kpiLabels(granularity)).toEqual(
        cards.map((card) => ({ key: card.key, label: card.label })),
      );
    });
  }

  it("semanal lee los campos *Period, con la comparación de la semana", () => {
    const summary = makeDashboardSummary({
      granularity: "week",
      createdThisPeriod: { count: 4, value: "400.00" },
      createdLastPeriod: { count: 2, value: "200.00" },
    });
    const cards = cardsByKey(summary);

    expect(cards.get("created")?.value).toBe("4");
    expect(cards.get("created")?.delta.text).toBe("+2 vs. semana anterior");
  });
});

// ---------------------------------------------------------------------------
// §37: el número crudo detrás de cada `value` y la función que lo formatea,
// para que OpportunityKpiCards cuente desde 0 reformateando cada frame con la
// MISMA lógica del string final.
// ---------------------------------------------------------------------------

describe("buildKpiCards — numericValue y formatValue (§37)", () => {
  it("creadas: el conteo del período, entero también en los frames intermedios", () => {
    const card = cardsByKey().get("created");
    expect(card?.numericValue).toBe(5);
    expect(card?.formatValue(2.6)).toBe("3");
  });

  it("ganado: el monto como número, formateado con formatAmount y la moneda del resumen", () => {
    const card = cardsByKey(
      makeDashboardSummary({ currency: "UYU", wonThisPeriod: { count: 1, value: "750.50" } }),
    ).get("won");
    expect(card?.numericValue).toBe(750.5);
    expect(card?.formatValue(123.456)).toBe("123.46 UYU");
  });

  it("tasa de cierre: el porcentaje, redondeado en los frames intermedios", () => {
    const card = cardsByKey().get("winRate");
    expect(card?.numericValue).toBe(50);
    expect(card?.formatValue(33.4)).toBe("33%");
  });

  it("tasa de cierre sin nada cerrado: numericValue null (no hay nada que contar) y el guion como value", () => {
    const card = cardsByKey(
      makeDashboardSummary({ wonThisPeriod: { count: 0, value: "0.00" }, lostCountThisPeriod: 0 }),
    ).get("winRate");
    expect(card?.numericValue).toBeNull();
    expect(card?.value).toBe("—");
  });

  it("formatValue(numericValue) === value en cada card: el último frame del conteo es el string ya probado", () => {
    const summaries = [
      makeDashboardSummary(),
      makeDashboardSummary({ currency: "UYU", wonThisPeriod: { count: 3, value: "1234.50" } }),
      makeDashboardSummary({
        createdThisPeriod: { count: 0, value: "0.00" },
        wonThisPeriod: { count: 0, value: "0.00" },
        lostCountThisPeriod: 4,
      }),
    ];
    for (const summary of summaries) {
      for (const card of buildKpiCards(summary)) {
        expect(card.numericValue).not.toBeNull();
        expect(card.formatValue(card.numericValue as number)).toBe(card.value);
      }
    }
  });
});
