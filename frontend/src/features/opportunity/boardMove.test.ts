import { describe, expect, it } from "vitest";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeStage } from "../../test/stageFixtures";
import { buildMovePatch, todayIsoDate } from "./boardMove";

// Las reglas del PATCH al soltar una tarjeta, una por una, sin simular
// ningún arrastre: ver el encabezado de boardMove.ts.

const TODAY = "2026-09-04";
const normal = makeStage({ id: "st-normal", isWon: false, isLost: false });
const won = makeStage({ id: "st-won", isWon: true, isLost: false });
const lost = makeStage({ id: "st-lost", isWon: false, isLost: true });

describe("buildMovePatch", () => {
  it("soltar en la misma columna no manda nada", () => {
    const opportunity = makeOpportunity({ stageId: "st-normal", status: "OPEN" });
    expect(buildMovePatch(opportunity, normal, TODAY)).toBeNull();
  });

  it("etapa normal → etapa normal con la oportunidad OPEN: solo stageId", () => {
    const opportunity = makeOpportunity({ stageId: "st1", status: "OPEN" });
    expect(buildMovePatch(opportunity, normal, TODAY)).toEqual({ stageId: "st-normal" });
  });

  it("a una etapa isWon: status WON y actualCloseDate hoy", () => {
    const opportunity = makeOpportunity({ stageId: "st1", status: "OPEN", actualCloseDate: null });
    expect(buildMovePatch(opportunity, won, TODAY)).toEqual({
      stageId: "st-won",
      status: "WON",
      actualCloseDate: TODAY,
    });
  });

  it("a una etapa isLost: status LOST y actualCloseDate hoy", () => {
    const opportunity = makeOpportunity({ stageId: "st1", status: "OPEN", actualCloseDate: null });
    expect(buildMovePatch(opportunity, lost, TODAY)).toEqual({
      stageId: "st-lost",
      status: "LOST",
      actualCloseDate: TODAY,
    });
  });

  it("a una etapa isWon/isLost con actualCloseDate propia: NO la pisa (no manda el campo)", () => {
    const opportunity = makeOpportunity({
      stageId: "st-lost",
      status: "LOST",
      actualCloseDate: "2026-08-01T00:00:00.000Z",
    });
    const patch = buildMovePatch(opportunity, won, TODAY);
    expect(patch).toEqual({ stageId: "st-won", status: "WON" });
    expect(patch).not.toHaveProperty("actualCloseDate");
  });

  it("reabrir: de cerrada a una etapa normal manda status OPEN y actualCloseDate null", () => {
    for (const status of ["WON", "LOST"] as const) {
      const opportunity = makeOpportunity({
        stageId: status === "WON" ? "st-won" : "st-lost",
        status,
        actualCloseDate: "2026-08-01T00:00:00.000Z",
      });
      expect(buildMovePatch(opportunity, normal, TODAY)).toEqual({
        stageId: "st-normal",
        status: "OPEN",
        actualCloseDate: null,
      });
    }
  });

  it("nunca toca lostReason", () => {
    const opportunity = makeOpportunity({ stageId: "st1", status: "LOST", lostReason: "Precio" });
    for (const target of [normal, won, lost]) {
      expect(buildMovePatch(opportunity, target, TODAY)).not.toHaveProperty("lostReason");
    }
  });
});

describe("todayIsoDate", () => {
  it("usa la fecha LOCAL, no la UTC", () => {
    // 23:30 local del 4 de septiembre: en UTC-3 ya es 5 de septiembre en
    // toISOString(), pero quien arrastra sigue viendo el 4 en su reloj.
    const localNight = new Date(2026, 8, 4, 23, 30);
    expect(todayIsoDate(localNight)).toBe("2026-09-04");
  });

  it("rellena mes y día con cero a la izquierda", () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
