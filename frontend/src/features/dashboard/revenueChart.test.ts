import { describe, expect, it } from "vitest";
import {
  CHART_BASELINE,
  CHART_BOX,
  hitBand,
  monthShortLabel,
  segmentsToPath,
  smoothSegments,
  toAreaPath,
  toChartPoints,
  toSmoothPath,
  tooltipLayout,
  type ChartPoint,
} from "./revenueChart";

// Ancho de fixture: el mismo 600 que tenía el viewBox fijo antes del §32,
// para que la geometría sea fácil de seguir a mano.
const WIDTH = 600;
const INNER_WIDTH = WIDTH - CHART_BOX.left - CHART_BOX.right;

function point(x: number, y: number, label = "ene", value = 0): ChartPoint {
  return { x, y, label, value };
}

// Todos los números de un `d` "M x,y C x,y x,y x,y …", en orden.
function numbersOf(d: string): number[] {
  return d
    .replace(/[MCLZ]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
}

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
    const points = toChartPoints(
      [
        { month: "2026-01", value: "0.00" },
        { month: "2026-02", value: "50.00" },
        { month: "2026-03", value: "100.00" },
      ],
      WIDTH,
    );
    expect(points.map((entry) => entry.label)).toEqual(["ene", "feb", "mar"]);
    expect(points[0].y).toBe(CHART_BASELINE);
    expect(points[2].y).toBe(CHART_BOX.top);
    expect(points[1].y).toBeCloseTo((CHART_BASELINE + CHART_BOX.top) / 2);
  });

  it("reparte los puntos en el ancho útil DEL ANCHO RECIBIDO, el primero a la izquierda y el último a la derecha", () => {
    const series = [
      { month: "2026-01", value: "1" },
      { month: "2026-02", value: "1" },
      { month: "2026-03", value: "1" },
    ];
    const points = toChartPoints(series, WIDTH);
    expect(points[0].x).toBe(CHART_BOX.left);
    expect(points[2].x).toBe(WIDTH - CHART_BOX.right);
    expect(points[1].x).toBeCloseTo((points[0].x + points[2].x) / 2);

    // Otro ancho, otra distribución: el último punto sigue el borde derecho.
    const wide = toChartPoints(series, 1400);
    expect(wide[0].x).toBe(CHART_BOX.left);
    expect(wide[2].x).toBe(1400 - CHART_BOX.right);
    // Y las Y no dependen del ancho.
    expect(wide.map((entry) => entry.y)).toEqual(points.map((entry) => entry.y));
  });

  it("todo en 0: todos los puntos sobre la base, sin dividir por cero", () => {
    const points = toChartPoints(
      [
        { month: "2026-01", value: "0.00" },
        { month: "2026-02", value: "0.00" },
      ],
      WIDTH,
    );
    expect(points.every((entry) => entry.y === CHART_BASELINE)).toBe(true);
  });

  it("un solo punto se centra", () => {
    const [single] = toChartPoints([{ month: "2026-01", value: "10" }], WIDTH);
    expect(single.x).toBe(CHART_BOX.left + INNER_WIDTH / 2);
  });
});

describe("smoothSegments", () => {
  const points = [point(0, 100), point(100, 0), point(200, 100), point(300, 50)];

  it("N puntos → N-1 tramos consecutivos, cada uno de un punto al siguiente", () => {
    const segments = smoothSegments(points);
    expect(segments).toHaveLength(3);
    segments.forEach((segment, index) => {
      expect(segment.from).toBe(points[index]);
      expect(segment.to).toBe(points[index + 1]);
    });
  });

  it("en los extremos el vecino faltante es el propio extremo (Catmull-Rom con puntos repetidos)", () => {
    const [first, , last] = smoothSegments(points);
    // c1 del primer tramo: from + (to - from)/6, porque previous = from.
    expect(first.c1.x).toBeCloseTo(0 + (100 - 0) / 6);
    expect(first.c1.y).toBeCloseTo(100 + (0 - 100) / 6);
    // c2 del último tramo: to - (to - from)/6, porque next = to.
    expect(last.c2.x).toBeCloseTo(300 - (300 - 200) / 6);
    expect(last.c2.y).toBeCloseTo(50 - (50 - 100) / 6);
  });

  it("los puntos de control se acotan al rango vertical de la serie: la curva nunca baja de la base", () => {
    // 100 → 0 → 250: sin la cota, el tramo hacia el 0 sigue de largo por
    // debajo de la base (un ingreso negativo que no existe).
    const dip = toChartPoints(
      [
        { month: "2026-01", value: "100" },
        { month: "2026-02", value: "0" },
        { month: "2026-03", value: "250" },
      ],
      WIDTH,
    );
    const segments = smoothSegments(dip);
    for (const segment of segments) {
      expect(segment.c1.y).toBeLessThanOrEqual(CHART_BASELINE);
      expect(segment.c2.y).toBeLessThanOrEqual(CHART_BASELINE);
      expect(segment.c1.y).toBeGreaterThanOrEqual(CHART_BOX.top);
      expect(segment.c2.y).toBeGreaterThanOrEqual(CHART_BOX.top);
    }
    // Y de verdad hacía falta acotar: el c2 del primer tramo se pasaba.
    expect(dip[1].y - (dip[2].y - dip[0].y) / 6).toBeGreaterThan(CHART_BASELINE);
  });

  it("con menos de 2 puntos no hay tramos", () => {
    expect(smoothSegments([])).toEqual([]);
    expect(smoothSegments([point(10, 10)])).toEqual([]);
  });
});

describe("segmentsToPath / toSmoothPath", () => {
  const points = [point(88, 204), point(200.25, 40.5), point(300, 100), point(400, 60)];

  it("arranca con M en el primer punto y tiene una C por tramo, con un decimal", () => {
    const d = segmentsToPath(smoothSegments(points));
    expect(d.startsWith("M88.0,204.0 C")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
    // Cada C termina exactamente en el punto siguiente.
    expect(d).toContain(" 200.3,40.5 C");
    expect(d.endsWith(" 400.0,60.0")).toBe(true);
  });

  it("un subconjunto de tramos arranca en el from de ese subconjunto (mismos controles que en la curva completa)", () => {
    const segments = smoothSegments(points);
    const last = segmentsToPath(segments.slice(-1));
    expect(last.startsWith("M300.0,100.0 C")).toBe(true);
    expect(last.match(/C/g)).toHaveLength(1);
    // El tramo suelto es literalmente la última C de la curva completa.
    expect(segmentsToPath(segments).endsWith(last.slice(last.indexOf("C")))).toBe(true);
  });

  it("un solo punto: solo el M; sin puntos: cadena vacía", () => {
    expect(toSmoothPath([point(332, 204)])).toBe("M332.0,204.0");
    expect(toSmoothPath([])).toBe("");
    expect(segmentsToPath([])).toBe("");
  });
});

describe("toAreaPath", () => {
  it("es la misma curva, cerrada contra la base por el último y el primer punto", () => {
    const points = [point(88, 204), point(200, 40), point(576, 100)];
    const d = toAreaPath(points);
    expect(d.startsWith(toSmoothPath(points))).toBe(true);
    expect(d.endsWith(" L576.0,204.0 L88.0,204.0 Z")).toBe(true);
    expect(Math.max(...numbersOf(d).filter((_, index) => index % 2 === 1))).toBe(CHART_BASELINE);
  });

  it("con menos de 2 puntos no hay área", () => {
    expect(toAreaPath([point(10, 10)])).toBe("");
    expect(toAreaPath([])).toBe("");
  });
});

describe("tooltipLayout", () => {
  const text = "oct: 100.00 USD";

  it("centrado sobre el punto, arriba de él, con el texto en el centro del rect", () => {
    const layout = tooltipLayout(point(300, 120), text, WIDTH);
    expect(layout.x + layout.width / 2).toBeCloseTo(300);
    expect(layout.textX).toBeCloseTo(300);
    expect(layout.y + layout.height).toBeLessThan(120);
    expect(layout.textY).toBeGreaterThan(layout.y);
    expect(layout.textY).toBeLessThan(layout.y + layout.height);
  });

  it("cerca de los bordes se corre hacia adentro para no salirse del svg", () => {
    const left = tooltipLayout(point(CHART_BOX.left, 120), text, WIDTH);
    expect(left.x).toBeGreaterThanOrEqual(0);
    const right = tooltipLayout(point(WIDTH - CHART_BOX.right, 120), text, WIDTH);
    expect(right.x + right.width).toBeLessThanOrEqual(WIDTH);
  });

  it("el punto más alto (techo) deja el tooltip dentro del svg", () => {
    const layout = tooltipLayout(point(300, CHART_BOX.top), text, WIDTH);
    expect(layout.y).toBeGreaterThanOrEqual(0);
  });
});

describe("hitBand", () => {
  const points = [point(88, 0), point(332, 0), point(576, 0)];

  it("cada franja va de mitad de camino con el vecino anterior a mitad con el siguiente", () => {
    expect(hitBand(points, 1, WIDTH)).toEqual({ x: 210, width: 244 });
  });

  it("la primera arranca en 0 y la última llega al ancho del gráfico", () => {
    expect(hitBand(points, 0, WIDTH)).toEqual({ x: 0, width: 210 });
    expect(hitBand(points, 2, WIDTH)).toEqual({ x: 454, width: WIDTH - 454 });
  });

  it("un solo punto cubre todo el ancho", () => {
    expect(hitBand([point(332, 0)], 0, WIDTH)).toEqual({ x: 0, width: WIDTH });
  });
});
