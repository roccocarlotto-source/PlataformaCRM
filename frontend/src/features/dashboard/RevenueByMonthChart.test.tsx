import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { stubResizeObserver } from "../../test/resizeObserverStub";
import { CHART_BOX } from "./revenueChart";
import { RevenueByMonthChart } from "./RevenueByMonthChart";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// jsdom no tiene ResizeObserver: el gráfico mide 600px de ancho en todos los
// tests de este archivo (ver resizeObserverStub.ts).
stubResizeObserver(600);

const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;

function renderChart() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RevenueByMonthChart />
    </QueryClientProvider>,
  );
}

function card() {
  return screen.getByLabelText("Ingresos ganados por mes");
}

describe("RevenueByMonthChart", () => {
  it("loading mientras llega el resumen", () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderChart();
    expect(within(card()).getByText("Cargando…")).toBeInTheDocument();
  });

  it("success: un SVG con la curva de 6 puntos, un marcador y un rótulo de mes por punto, y la tabla accesible", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderChart();

    const svg = await within(card()).findByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("USD"));

    // Curva suave: el tramo sólido cubre los primeros 5 puntos (4 cúbicas) y
    // el último tramo, el del mes en curso, va aparte y punteado.
    const solid = svg.querySelector("path.ds-chart-line--solid");
    expect(solid?.getAttribute("d")).toMatch(/^M\d/);
    expect(solid?.getAttribute("d")?.match(/C/g)).toHaveLength(4);
    expect(solid).toHaveAttribute("pathLength", "1");
    const partial = svg.querySelector("path.ds-chart-line--partial");
    expect(partial?.getAttribute("d")?.match(/C/g)).toHaveLength(1);
    // Área rellena con el degradé definido en el propio svg.
    const area = svg.querySelector("path.ds-chart-area");
    expect(area?.getAttribute("d")?.endsWith("Z")).toBe(true);
    const gradientId = svg.querySelector("linearGradient")?.getAttribute("id");
    expect(area?.getAttribute("fill")).toBe(`url(#${gradientId})`);

    expect(svg.querySelectorAll("circle")).toHaveLength(6);

    // Eje X: las abreviaturas de MONTHS, en el orden cronológico del backend.
    const months = ["oct", "nov", "dic", "ene", "feb", "mar"];
    for (const month of months) {
      expect(within(svg as HTMLElement).getByText(month)).toBeInTheDocument();
    }
    // El máximo de la serie rotula el techo, en la moneda.
    expect(within(svg as HTMLElement).getByText("3000.00 USD")).toBeInTheDocument();

    // Tooltip nativo por marcador y tabla para lector de pantalla.
    expect(svg.querySelector("circle title")?.textContent).toBe("oct: 100.00 USD");
    const table = within(card()).getByRole("table", { name: "Ingresos ganados por mes" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getByText("2026-03")).toBeInTheDocument();
  });

  it("el viewBox y el tamaño renderizado coinciden 1:1 con el ancho medido", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderChart();

    const svg = await within(card()).findByRole("img");
    expect(svg).toHaveAttribute("width", "600");
    expect(svg).toHaveAttribute("height", String(CHART_BOX.height));
    expect(svg).toHaveAttribute("viewBox", `0 0 600 ${CHART_BOX.height}`);
    // Y los puntos se reparten en ESE ancho: el último marcador queda en el
    // borde derecho del área útil.
    const circles = Array.from(svg.querySelectorAll("circle"));
    expect(Number(circles[0].getAttribute("cx"))).toBe(CHART_BOX.left);
    expect(Number(circles[5].getAttribute("cx"))).toBe(600 - CHART_BOX.right);
  });

  it("tooltip visual y guía por marcador, ocultos para tecnología asistiva (el <title> es la vía accesible)", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderChart();

    const svg = await within(card()).findByRole("img");
    const markers = svg.querySelectorAll("g.ds-chart-marker");
    expect(markers).toHaveLength(6);
    const first = markers[0];
    expect(first.querySelector(".ds-chart-hit")).not.toBeNull();
    expect(first.querySelector(".ds-chart-guide")).not.toBeNull();
    const tooltip = first.querySelector(".ds-chart-tooltip");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(tooltip?.querySelector("text")?.textContent).toBe("oct: 100.00 USD");
    // Índice para el escalonado de la entrada.
    expect((markers[3] as SVGGElement).style.getPropertyValue("--ds-chart-index")).toBe("3");
  });

  it("el máximo toca el techo y un mes en 0 queda sobre la base", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderChart();

    const svg = await within(card()).findByRole("img");
    const circles = Array.from(svg.querySelectorAll("circle"));
    const cy = circles.map((circle) => Number(circle.getAttribute("cy")));
    // nov (índice 1) es 0.00 → base; mar (índice 5) es el máximo → techo.
    expect(cy[1]).toBeGreaterThan(cy[5]);
    expect(Math.max(...cy)).toBe(cy[1]);
    expect(Math.min(...cy)).toBe(cy[5]);
  });

  it("sin ancho medido todavía no dibuja el svg (nunca un ancho inventado), pero la tabla accesible ya está", async () => {
    // Un ResizeObserver que nunca notifica: el primer frame, congelado.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
      renderChart();

      const table = await within(card()).findByRole("table", {
        name: "Ingresos ganados por mes",
      });
      expect(table).toBeInTheDocument();
      expect(within(card()).queryByRole("img")).not.toBeInTheDocument();
    } finally {
      stubResizeObserver(600);
    }
  });

  it("empty: seis meses en 0 → empty state explícito, sin SVG", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json(
          makeDashboardSummary({
            revenueByMonth: [
              { month: "2025-10", value: "0.00" },
              { month: "2025-11", value: "0.00" },
              { month: "2025-12", value: "0.00" },
              { month: "2026-01", value: "0.00" },
              { month: "2026-02", value: "0.00" },
              { month: "2026-03", value: "0.00" },
            ],
          }),
        ),
      ),
    );
    renderChart();

    await waitFor(() =>
      expect(
        within(card()).getByText("Todavía no hay ingresos ganados en los últimos 6 meses."),
      ).toBeInTheDocument(),
    );
    expect(within(card()).queryByRole("img")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error: alert con el mensaje real, sin gráfico", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderChart();

    await waitFor(() =>
      expect(within(card()).getByRole("alert")).toHaveTextContent(
        "No pudimos cargar los ingresos por mes: caída",
      ),
    );
    expect(within(card()).queryByRole("img")).not.toBeInTheDocument();
  });
});
