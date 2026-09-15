import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { OpportunityKpiCards } from "./OpportunityKpiCards";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;

function renderCards() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityKpiCards />
    </QueryClientProvider>,
  );
}

function section() {
  return screen.getByLabelText("Resumen comercial");
}

describe("OpportunityKpiCards", () => {
  it("las 4 cards con los rótulos del mockup, siempre presentes (también mientras carga)", async () => {
    server.use(
      http.get(summaryUrl, async () => {
        await delay(100);
        return HttpResponse.json(makeDashboardSummary());
      }),
    );
    renderCards();

    const labels = within(section())
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(labels).toEqual([
      "Oportunidades abiertas",
      "Valor del pipeline",
      "Ganado este mes",
      "Tasa de cierre del mes",
    ]);
    expect(within(section()).getAllByText("Cargando…")).toHaveLength(4);

    await waitFor(() => expect(within(section()).getByText("3")).toBeInTheDocument());
  });

  it("success: valor grande y línea de variación por card, con la clase de dirección", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderCards();

    await waitFor(() => expect(within(section()).getByText("3")).toBeInTheDocument());
    expect(within(section()).getByText("4500.00 USD")).toBeInTheDocument();
    expect(within(section()).getByText("3000.00 USD")).toBeInTheDocument();
    expect(within(section()).getByText("50%")).toBeInTheDocument();

    const up = within(section()).getByText("+2 nuevas oportunidades vs. mes anterior");
    expect(up).toHaveClass("ds-kpi-delta", "ds-kpi-delta--up");
    expect(within(section()).getByText("+100% en valor nuevo vs. mes anterior")).toHaveClass(
      "ds-kpi-delta--up",
    );
    expect(within(section()).getByText("+100% vs. mes anterior")).toHaveClass("ds-kpi-delta--up");
    expect(within(section()).getByText("0 pts vs. mes anterior")).toHaveClass(
      "ds-kpi-delta--neutral",
    );
  });

  it("variación negativa en rojo y sin base de comparación en neutral con guion", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json(
          makeDashboardSummary({
            wonThisMonth: { count: 1, value: "500.00" },
            wonLastMonth: { count: 1, value: "1000.00" },
            createdLastMonth: { count: 0, value: "0.00" },
          }),
        ),
      ),
    );
    renderCards();

    await waitFor(() =>
      expect(within(section()).getByText("-50% vs. mes anterior")).toHaveClass(
        "ds-kpi-delta--down",
      ),
    );
    const sinBase = within(section()).getByText(/^— sin base de comparación/);
    expect(sinBase).toHaveClass("ds-kpi-delta--neutral");
  });

  it("error: un alert por card con el mensaje real, sin ningún número", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderCards();

    await waitFor(() => expect(within(section()).getAllByRole("alert")).toHaveLength(4));
    expect(within(section()).getAllByRole("alert")[0]).toHaveTextContent(
      "No pudimos cargar este dato: caída",
    );
    expect(within(section()).queryByText("3")).not.toBeInTheDocument();
  });

  it("todo en cero: números en 0 y guion en la tasa, ningún porcentaje inventado", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json(
          makeDashboardSummary({
            openCount: 0,
            openValue: "0.00",
            createdThisMonth: { count: 0, value: "0.00" },
            createdLastMonth: { count: 0, value: "0.00" },
            wonThisMonth: { count: 0, value: "0.00" },
            wonLastMonth: { count: 0, value: "0.00" },
            lostCountThisMonth: 0,
            lostCountLastMonth: 0,
          }),
        ),
      ),
    );
    renderCards();

    await waitFor(() => expect(within(section()).getByText("0")).toBeInTheDocument());
    expect(within(section()).getByText("—")).toBeInTheDocument();
    expect(within(section()).queryByText(/%/)).not.toBeInTheDocument();
  });
});
