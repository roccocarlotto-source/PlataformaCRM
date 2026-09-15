import { describe, expect, it } from "vitest";
import { CHART_BOX, monthShortLabel, toChartPoints, toPolylinePoints } from "./revenueChart";

const BASELINE = CHART_BOX.height - CHART_BOX.bottom;

describe("monthShortLabel", () => {
  it("YYYY-MM → la misma abreviatura que Mis tareas, sin pasar por Date", () => {
    expect(monthShortLabel("2026-01")).toBe("ene");
    expect(monthShortLabel("2026-03")).toBe("mar");
    expect(monthShortLabel("2025-12")).toBe("dic");
  });

  it("un mes que no se puede leer se devuelve tal cual, nunca undefined", () => {
    expect(monthShortLabel("raro")).toBe("raro");
  });
});

describe("toChartPoints", () => {
  it("escala al máximo de la serie: el máximo toca el techo y 0 queda en la base", () => {
    const points = toChartPoints([
      { month: "2026-01", value: "0.00" },
      { month: "2026-02", value: "50.00" },
      { month: "2026-03", value: "100.00" },
    ]);
    expect(points.map((point) => point.label)).toEqual(["ene", "feb", "mar"]);
    expect(points[0].y).toBe(BASELINE);
    expect(points[2].y).toBe(CHART_BOX.top);
    expect(points[1].y).toBeCloseTo((BASELINE + CHART_BOX.top) / 2);
  });

  it("reparte los puntos en el ancho útil, el primero a la izquierda y el último a la derecha", () => {
    const points = toChartPoints([
      { month: "2026-01", value: "1" },
      { month: "2026-02", value: "1" },
      { month: "2026-03", value: "1" },
    ]);
    expect(points[0].x).toBe(CHART_BOX.left);
    expect(points[2].x).toBe(CHART_BOX.width - CHART_BOX.right);
    expect(points[1].x).toBeCloseTo((points[0].x + points[2].x) / 2);
  });

  it("todo en 0: todos los puntos sobre la base, sin dividir por cero", () => {
    const points = toChartPoints([
      { month: "2026-01", value: "0.00" },
      { month: "2026-02", value: "0.00" },
    ]);
    expect(points.every((point) => point.y === BASELINE)).toBe(true);
  });

  it("un solo punto se centra", () => {
    const [point] = toChartPoints([{ month: "2026-01", value: "10" }]);
    const innerWidth = CHART_BOX.width - CHART_BOX.left - CHART_BOX.right;
    expect(point.x).toBe(CHART_BOX.left + innerWidth / 2);
  });
});

describe("toPolylinePoints", () => {
  it("'x,y' con un decimal, separados por espacio", () => {
    expect(
      toPolylinePoints([
        { x: 56, y: 172, label: "ene", value: 0 },
        { x: 100.25, y: 16.5, label: "feb", value: 1 },
      ]),
    ).toBe("56.0,172.0 100.3,16.5");
  });
});
