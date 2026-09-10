import { describe, expect, it } from "vitest";
import { formatProbability, probabilityWidth } from "./probability";

// Presentación de Stage.probability (docs/frontend-cambios-pendientes.md §14).
// probability llega como string (Prisma.Decimal serializado), por eso los
// casos se escriben así.
describe("formatProbability", () => {
  it("0 muestra guión, no 0% — cualquier forma de escribir el cero", () => {
    expect(formatProbability("0")).toBe("-");
    expect(formatProbability("0.0")).toBe("-");
    expect(formatProbability("0.00")).toBe("-");
  });

  it("cualquier otro valor se muestra como N% sin ceros de más", () => {
    expect(formatProbability("37.5")).toBe("37.5%");
    expect(formatProbability("25.50")).toBe("25.5%");
    expect(formatProbability("100")).toBe("100%");
    expect(formatProbability("0.5")).toBe("0.5%");
  });
});

describe("probabilityWidth", () => {
  it("con 0 la barra sigue vacía: el guión es solo del texto", () => {
    expect(probabilityWidth("0")).toBe(0);
  });

  it("acota a 0–100 y no dibuja una barra rota con NaN", () => {
    expect(probabilityWidth("37.5")).toBe(37.5);
    expect(probabilityWidth("150")).toBe(100);
    expect(probabilityWidth("-5")).toBe(0);
    expect(probabilityWidth("abc")).toBe(0);
  });
});
