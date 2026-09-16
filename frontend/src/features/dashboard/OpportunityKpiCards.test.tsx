import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { COUNT_UP_DURATION_MS } from "../../lib/useCountUp";
import { OpportunityKpiCards } from "./OpportunityKpiCards";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;

function renderCards(granularity: "month" | "week" | "day" = "month") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityKpiCards granularity={granularity} />
    </QueryClientProvider>,
  );
}

function section() {
  return screen.getByLabelText("Resumen comercial");
}

describe("OpportunityKpiCards", () => {
  it("las 3 cards con los rótulos del mockup, siempre presentes (también mientras carga)", async () => {
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
      "Oportunidades creadas este mes",
      "Ganado este mes",
      "Tasa de cierre del mes",
    ]);
    expect(within(section()).getAllByText("Cargando…")).toHaveLength(3);

    await waitFor(() => expect(within(section()).getByText("5")).toBeInTheDocument());
  });

  // §35: el esqueleto se rotula con el prop (no hay datos todavía), así que la
  // fila no cambia de forma ni de texto cuando llega el resumen.
  it("los rótulos del esqueleto siguen a la granularidad del prop, antes de que llegue el resumen", async () => {
    server.use(
      http.get(summaryUrl, async () => {
        await delay(100);
        return HttpResponse.json(makeDashboardSummary({ granularity: "day" }));
      }),
    );
    renderCards("day");

    const cargando = within(section())
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(cargando).toEqual(["Oportunidades creadas hoy", "Ganado hoy", "Tasa de cierre del día"]);

    await waitFor(() => expect(within(section()).getByText("5")).toBeInTheDocument());
    expect(
      within(section())
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(cargando);
    expect(within(section()).getByText("+2 vs. ayer")).toBeInTheDocument();
  });

  it("success: valor grande y línea de variación por card, con la clase de dirección", async () => {
    server.use(http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())));
    renderCards();

    // El número grande de la primera card son las CREADAS en el período
    // (createdThisPeriod.count = 5), no las abiertas de ahora (openCount = 3).
    await waitFor(() => expect(within(section()).getByText("5")).toBeInTheDocument());
    expect(within(section()).queryByText("3")).not.toBeInTheDocument();
    // openValue (4500.00) tampoco se muestra desde el §36: la card que lo
    // leía era "Valor del pipeline".
    expect(within(section()).queryByText("4500.00 USD")).not.toBeInTheDocument();
    expect(within(section()).getByText("3000.00 USD")).toBeInTheDocument();
    expect(within(section()).getByText("50%")).toBeInTheDocument();

    const up = within(section()).getByText("+2 vs. mes anterior");
    expect(up).toHaveClass("ds-kpi-delta", "ds-kpi-delta--up");
    expect(within(section()).getByText("+100% vs. mes anterior")).toHaveClass("ds-kpi-delta--up");
    expect(within(section()).getByText("0 pts vs. mes anterior")).toHaveClass(
      "ds-kpi-delta--neutral",
    );
  });

  it("pide el resumen con la granularidad del prop", async () => {
    const pedidas: string[] = [];
    server.use(
      http.get(summaryUrl, ({ request }) => {
        pedidas.push(new URL(request.url).searchParams.get("granularity") ?? "");
        return HttpResponse.json(makeDashboardSummary({ granularity: "week" }));
      }),
    );
    renderCards("week");

    await waitFor(() => expect(within(section()).getByText("5")).toBeInTheDocument());
    expect(pedidas).toEqual(["week"]);
  });

  it("variación negativa en rojo y sin base de comparación en neutral con guion", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json(
          makeDashboardSummary({
            // Menos creadas que el período anterior: la variación baja.
            createdThisPeriod: { count: 1, value: "500.00" },
            createdLastPeriod: { count: 4, value: "1000.00" },
            // Nada cerrado el período anterior: "Ganado" y "Tasa de cierre"
            // se quedan sin base de comparación.
            wonLastPeriod: { count: 0, value: "0.00" },
            lostCountLastPeriod: 0,
          }),
        ),
      ),
    );
    renderCards();

    await waitFor(() =>
      expect(within(section()).getByText("-3 vs. mes anterior")).toHaveClass("ds-kpi-delta--down"),
    );
    const sinBase = within(section()).getAllByText(/^— sin base de comparación/);
    expect(sinBase).toHaveLength(2);
    for (const linea of sinBase) expect(linea).toHaveClass("ds-kpi-delta--neutral");
  });

  it("error: un alert por card con el mensaje real, sin ningún número", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderCards();

    await waitFor(() => expect(within(section()).getAllByRole("alert")).toHaveLength(3));
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
            createdThisPeriod: { count: 0, value: "0.00" },
            createdLastPeriod: { count: 0, value: "0.00" },
            wonThisPeriod: { count: 0, value: "0.00" },
            wonLastPeriod: { count: 0, value: "0.00" },
            lostCountThisPeriod: 0,
            lostCountLastPeriod: 0,
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

// ---------------------------------------------------------------------------
// §37: conteo desde 0 solo en la primera carga. El resto del archivo corre con
// el matchMedia global de test/setup.ts (reduced motion → valor final
// directo); acá se pisa con uno sin esa preferencia. Solo se falsea
// requestAnimationFrame: MSW y waitFor siguen con timers reales.
// ---------------------------------------------------------------------------

describe("OpportunityKpiCards — conteo de llegada (§37)", () => {
  function animateForReal() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  function values() {
    return Array.from(section().querySelectorAll(".ds-kpi-value")).map((dd) => dd.textContent);
  }

  function renderSwitchable(granularity: "month" | "week" | "day") {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OpportunityKpiCards granularity={granularity} />
      </QueryClientProvider>,
    );
    return (next: "month" | "week" | "day") =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <OpportunityKpiCards granularity={next} />
        </QueryClientProvider>,
      );
  }

  // Resumen por granularidad; el semanal con otros números para distinguirlo.
  function summaryByGranularity() {
    return http.get(summaryUrl, async ({ request }) => {
      const granularity = new URL(request.url).searchParams.get("granularity");
      if (granularity === "week") {
        await delay(50);
        return HttpResponse.json(
          makeDashboardSummary({
            granularity: "week",
            createdThisPeriod: { count: 9, value: "0.00" },
            wonThisPeriod: { count: 3, value: "1200.00" },
            lostCountThisPeriod: 1,
          }),
        );
      }
      return HttpResponse.json(makeDashboardSummary());
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("la primera carga cuenta desde 0: a mitad del conteo los números no son los finales, y al terminar lo son exactos", async () => {
    animateForReal();
    server.use(summaryByGranularity());
    renderSwitchable("month");

    await waitFor(() => expect(values()).toEqual(["0", "0.00 USD", "0%"]));

    advance(COUNT_UP_DURATION_MS / 3);
    const aMitad = values();
    expect(aMitad).not.toEqual(["0", "0.00 USD", "0%"]);
    expect(aMitad).not.toEqual(["5", "3000.00 USD", "50%"]);

    advance(COUNT_UP_DURATION_MS);
    expect(values()).toEqual(["5", "3000.00 USD", "50%"]);
  });

  it("cambiar a un período NO visitado (pasa por Cargando…) muestra los números nuevos directo, sin volver a contar", async () => {
    animateForReal();
    server.use(summaryByGranularity());
    const setGranularity = renderSwitchable("month");

    await waitFor(() => expect(values()).toEqual(["0", "0.00 USD", "0%"]));
    advance(COUNT_UP_DURATION_MS + 50);
    expect(values()).toEqual(["5", "3000.00 USD", "50%"]);

    setGranularity("week");
    await waitFor(() => expect(within(section()).getAllByText("Cargando…")).toHaveLength(3));
    // Sin avanzar ningún frame: si contara, se quedaría en 0.
    await waitFor(() => expect(values()).toEqual(["9", "1200.00 USD", "75%"]));
  });

  it("volver al período de la primera carga mientras el otro todavía carga tampoco vuelve a contar", async () => {
    animateForReal();
    server.use(summaryByGranularity());
    const setGranularity = renderSwitchable("month");

    await waitFor(() => expect(values()).toEqual(["0", "0.00 USD", "0%"]));
    advance(COUNT_UP_DURATION_MS + 50);

    setGranularity("week");
    await waitFor(() => expect(within(section()).getAllByText("Cargando…")).toHaveLength(3));
    // El mensual está en caché (la misma referencia del primer resumen) y los
    // números se vuelven a montar: tienen que aparecer ya asentados.
    setGranularity("month");
    expect(values()).toEqual(["5", "3000.00 USD", "50%"]);
  });

  it('una tasa de cierre en "—" en la primera carga que después tiene número tampoco cuenta', async () => {
    animateForReal();
    server.use(
      http.get(summaryUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity");
        return HttpResponse.json(
          granularity === "week"
            ? makeDashboardSummary({ granularity: "week" })
            : makeDashboardSummary({
                wonThisPeriod: { count: 0, value: "0.00" },
                lostCountThisPeriod: 0,
              }),
        );
      }),
    );
    const setGranularity = renderSwitchable("month");

    await waitFor(() => expect(values()).toEqual(["0", "0.00 USD", "—"]));
    advance(COUNT_UP_DURATION_MS + 50);
    expect(values()).toEqual(["5", "0.00 USD", "—"]);

    setGranularity("week");
    await waitFor(() => expect(values()).toEqual(["5", "3000.00 USD", "50%"]));
  });
});
