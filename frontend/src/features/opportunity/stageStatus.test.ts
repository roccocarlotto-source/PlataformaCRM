import { describe, expect, it } from "vitest";
import { stageStatusChange } from "./stageStatus";

// La regla compartida por el embudo (boardMove.ts) y el formulario
// (OpportunityFormPage.tsx), sin ninguno de los dos alrededor. Que cada
// consumidor la traduzca bien a SU lenguaje lo prueban boardMove.test.ts
// (PATCH) y OpportunityFormPage.test.tsx (estado local del formulario).

const normal = { isWon: false, isLost: false };
const won = { isWon: true, isLost: false };
const lost = { isWon: false, isLost: true };

describe("stageStatusChange", () => {
  it("etapa normal sobre una oportunidad abierta: no cambia nada", () => {
    expect(stageStatusChange({ status: "OPEN", actualCloseDate: null }, normal)).toBeNull();
  });

  it("etapa isWon sin fecha real cargada: cierra como ganada y pide la de hoy", () => {
    expect(stageStatusChange({ status: "OPEN", actualCloseDate: null }, won)).toEqual({
      status: "WON",
      actualCloseDate: "today",
    });
  });

  it("etapa isLost sin fecha real cargada: cierra como perdida y pide la de hoy", () => {
    expect(stageStatusChange({ status: "OPEN", actualCloseDate: null }, lost)).toEqual({
      status: "LOST",
      actualCloseDate: "today",
    });
  });

  it("una fecha real ya cargada nunca se pisa", () => {
    for (const target of [won, lost]) {
      expect(stageStatusChange({ status: "OPEN", actualCloseDate: "2026-08-01" }, target)).toEqual({
        status: target === won ? "WON" : "LOST",
        actualCloseDate: "keep",
      });
    }
  });

  it("etapa normal sobre una oportunidad cerrada: reabre y vacía la fecha", () => {
    for (const status of ["WON", "LOST"] as const) {
      expect(stageStatusChange({ status, actualCloseDate: "2026-08-01" }, normal)).toEqual({
        status: "OPEN",
        actualCloseDate: "clear",
      });
    }
  });

  it("los flags mandan, no el estado actual: una cerrada que va a otra etapa de cierre se recalcula", () => {
    expect(stageStatusChange({ status: "LOST", actualCloseDate: null }, won)).toEqual({
      status: "WON",
      actualCloseDate: "today",
    });
  });
});
