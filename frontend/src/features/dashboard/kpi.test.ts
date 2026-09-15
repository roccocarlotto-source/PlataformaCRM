import { describe, expect, it } from "vitest";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { buildKpiCards, percentDelta, winRate } from "./kpi";

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
  it("devuelve las 4 cards en el orden del mockup", () => {
    expect(buildKpiCards(makeDashboardSummary()).map((card) => card.key)).toEqual([
      "open",
      "pipelineValue",
      "wonThisMonth",
      "winRate",
    ]);
  });

  it("abiertas: el número grande es openCount y la variación cuenta NUEVAS por mes, no 'abiertas hace un mes'", () => {
    const card = cardsByKey().get("open");
    expect(card?.value).toBe("3");
    expect(card?.delta).toEqual({
      direction: "up",
      text: "+2 nuevas oportunidades vs. mes anterior",
    });
  });

  it("abiertas: menos creadas que el mes anterior baja; igual cantidad es neutral", () => {
    const menos = cardsByKey(
      makeDashboardSummary({
        createdThisMonth: { count: 1, value: "0.00" },
        createdLastMonth: { count: 4, value: "0.00" },
      }),
    ).get("open");
    expect(menos?.delta).toEqual({
      direction: "down",
      text: "-3 nuevas oportunidades vs. mes anterior",
    });

    const igual = cardsByKey(
      makeDashboardSummary({
        createdThisMonth: { count: 2, value: "0.00" },
        createdLastMonth: { count: 2, value: "0.00" },
      }),
    ).get("open");
    expect(igual?.delta.direction).toBe("neutral");
    expect(igual?.delta.text).toBe("0 nuevas oportunidades vs. mes anterior");
  });

  it("valor del pipeline: SUM de abiertas en la moneda de la organización, variación sobre el valor CREADO por mes", () => {
    const card = cardsByKey().get("pipelineValue");
    expect(card?.value).toBe("4500.00 USD");
    expect(card?.delta).toEqual({
      direction: "up",
      text: "+100% en valor nuevo vs. mes anterior",
    });
  });

  it("valor del pipeline: sin valor creado el mes anterior → neutral con guion, sin porcentaje inventado", () => {
    const card = cardsByKey(
      makeDashboardSummary({ createdLastMonth: { count: 0, value: "0.00" } }),
    ).get("pipelineValue");
    expect(card?.delta.direction).toBe("neutral");
    expect(card?.delta.text).toMatch(/^—/);
  });

  it("ganado este mes: monto en la moneda y variación relativa contra el mes anterior, negativa en rojo", () => {
    const card = cardsByKey(
      makeDashboardSummary({
        currency: "UYU",
        wonThisMonth: { count: 1, value: "750.00" },
        wonLastMonth: { count: 2, value: "1000.00" },
      }),
    ).get("wonThisMonth");
    expect(card?.value).toBe("750.00 UYU");
    expect(card?.delta).toEqual({ direction: "down", text: "-25% vs. mes anterior" });
  });

  it("tasa de cierre: WON/(WON+LOST) del mes, variación en puntos porcentuales", () => {
    // Este mes 2 WON / 2 LOST = 50%; el anterior 1 WON / 1 LOST = 50%.
    const igual = cardsByKey().get("winRate");
    expect(igual?.value).toBe("50%");
    expect(igual?.delta).toEqual({ direction: "neutral", text: "0 pts vs. mes anterior" });

    const sube = cardsByKey(
      makeDashboardSummary({
        wonThisMonth: { count: 3, value: "0.00" },
        lostCountThisMonth: 1,
        wonLastMonth: { count: 1, value: "0.00" },
        lostCountLastMonth: 3,
      }),
    ).get("winRate");
    expect(sube?.value).toBe("75%");
    expect(sube?.delta).toEqual({ direction: "up", text: "+50 pts vs. mes anterior" });
  });

  it("tasa de cierre: sin nada cerrado este mes el valor es un guion; sin nada cerrado el anterior, la variación es neutral", () => {
    const sinEsteMes = cardsByKey(
      makeDashboardSummary({ wonThisMonth: { count: 0, value: "0.00" }, lostCountThisMonth: 0 }),
    ).get("winRate");
    expect(sinEsteMes?.value).toBe("—");
    expect(sinEsteMes?.delta.direction).toBe("neutral");

    const sinAnterior = cardsByKey(
      makeDashboardSummary({ wonLastMonth: { count: 0, value: "0.00" }, lostCountLastMonth: 0 }),
    ).get("winRate");
    expect(sinAnterior?.value).toBe("50%");
    expect(sinAnterior?.delta.direction).toBe("neutral");
    expect(sinAnterior?.delta.text).toMatch(/^—/);
  });
});
