import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { COUNT_UP_DURATION_MS } from "../../lib/useCountUp";
import { VehicleSummaryCards } from "./VehicleSummaryCards";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const vehiclesUrl = `${env.apiUrl}/api/vehicles`;

// Los dos GET /vehicles?pageSize=1 (sin y con status=AVAILABLE), igual que en
// DashboardPage.test.tsx: el handler distingue por la query.
function vehiclesSummaryHandler(totals = { inStock: 42, available: 17 }) {
  return http.get(vehiclesUrl, ({ request }) => {
    const total = new URL(request.url).searchParams.has("status")
      ? totals.available
      : totals.inStock;
    return HttpResponse.json({
      data: [],
      pagination: { page: 1, pageSize: 1, total, totalPages: total },
    });
  });
}

function renderCards(props: { countUp?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <VehicleSummaryCards {...props} />
    </QueryClientProvider>,
  );
}

function values() {
  return Array.from(
    screen.getByRole("region", { name: "Resumen de stock" }).querySelectorAll(".ds-kpi-value"),
  ).map((dd) => dd.textContent);
}

// Sin preferencia de movimiento reducido (el matchMedia global de
// test/setup.ts la declara) y con requestAnimationFrame bajo timers falsos;
// MSW y waitFor siguen con timers reales.
function animateForReal() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VehicleSummaryCards", () => {
  it("los dos conteos, con el reduced motion del setup: el valor final directo", async () => {
    server.use(vehiclesSummaryHandler());
    renderCards({ countUp: true });

    await waitFor(() => expect(values()).toEqual(["42", "17"]));
  });

  it("error: alert con el mensaje real y sin número", async () => {
    server.use(
      http.get(vehiclesUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderCards({ countUp: true });

    const region = within(screen.getByRole("region", { name: "Resumen de stock" }));
    await waitFor(() => expect(region.getAllByRole("alert")).toHaveLength(2));
    expect(region.getAllByRole("alert")[0]).toHaveTextContent("No pudimos cargar este dato: caída");
    expect(values()).toEqual([]);
  });

  // §37
  it("countUp: cuenta desde 0 al llegar, pasa por valores intermedios y termina exacto", async () => {
    animateForReal();
    server.use(vehiclesSummaryHandler());
    renderCards({ countUp: true });

    await waitFor(() => expect(values()).toEqual(["0", "0"]));

    act(() => {
      vi.advanceTimersByTime(COUNT_UP_DURATION_MS / 3);
    });
    const [inStock, available] = values().map(Number);
    expect(inStock).toBeGreaterThan(0);
    expect(inStock).toBeLessThan(42);
    expect(available).toBeGreaterThan(0);
    expect(available).toBeLessThan(17);

    act(() => {
      vi.advanceTimersByTime(COUNT_UP_DURATION_MS);
    });
    expect(values()).toEqual(["42", "17"]);
  });

  // El listado de stock (VehicleListPage) usa el componente sin countUp: el
  // pedido del §37 fue para el Dashboard.
  it("sin countUp (listado de stock) los números aparecen directo aunque no haya reduced motion", async () => {
    animateForReal();
    server.use(vehiclesSummaryHandler());
    renderCards();

    await waitFor(() => expect(values()).toEqual(["42", "17"]));
  });
});
