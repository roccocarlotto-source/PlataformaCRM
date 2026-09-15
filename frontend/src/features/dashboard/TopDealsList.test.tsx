import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { TopDealsList } from "./TopDealsList";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TopDealsList />
    </QueryClientProvider>,
  );
}

function card() {
  return screen.getByLabelText("Mayores oportunidades abiertas");
}

function listResponse(data: ReturnType<typeof makeOpportunity>[]) {
  return HttpResponse.json({
    data,
    pagination: { page: 1, pageSize: 5, total: data.length, totalPages: data.length ? 1 : 0 },
  });
}

describe("TopDealsList", () => {
  it("espera la moneda del resumen y recién entonces pide OPEN en esa moneda, por amount desc, 5", async () => {
    const captured: URLSearchParams[] = [];
    let summaryResolved = false;
    server.use(
      http.get(summaryUrl, async () => {
        await delay(100);
        summaryResolved = true;
        return HttpResponse.json(makeDashboardSummary({ currency: "UYU" }));
      }),
      http.get(opportunitiesUrl, ({ request }) => {
        expect(summaryResolved).toBe(true);
        captured.push(new URL(request.url).searchParams);
        return listResponse([
          makeOpportunity({ id: "op1", title: "Flota nueva", amount: "8000.00", currency: "UYU" }),
          makeOpportunity({ id: "op2", title: "Renovación", amount: "2000.00", currency: "UYU" }),
        ]);
      }),
    );
    renderList();

    expect(within(card()).getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(within(card()).getByText("Flota nueva")).toBeInTheDocument());

    expect(captured).toHaveLength(1);
    expect(captured[0]?.get("status")).toBe("OPEN");
    expect(captured[0]?.get("currency")).toBe("UYU");
    expect(captured[0]?.get("sortBy")).toBe("amount");
    expect(captured[0]?.get("sortOrder")).toBe("desc");
    expect(captured[0]?.get("pageSize")).toBe("5");

    // Barras proporcionales al mayor monto: la primera al 100%, la segunda al 25%.
    const fills = card().querySelectorAll<HTMLElement>(".ds-meter-fill");
    expect(fills).toHaveLength(2);
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("25%");
    expect(within(card()).getByText("8000.00 UYU")).toBeInTheDocument();
  });

  it("si el resumen falla no se pide el listado y se muestra el error del resumen", async () => {
    let listRequests = 0;
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
      http.get(opportunitiesUrl, () => {
        listRequests += 1;
        return listResponse([]);
      }),
    );
    renderList();

    await waitFor(() =>
      expect(within(card()).getByRole("alert")).toHaveTextContent(
        "No pudimos cargar las mayores oportunidades: caída",
      ),
    );
    expect(listRequests).toBe(0);
  });

  it("si falla el listado, el error es el del listado", async () => {
    server.use(
      http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())),
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({ error: { message: "lista rota" } }, { status: 500 }),
      ),
    );
    renderList();

    await waitFor(() => expect(within(card()).getByRole("alert")).toHaveTextContent("lista rota"));
  });

  it("empty: sin abiertas en la moneda de la organización, lo dice con la moneda", async () => {
    server.use(
      http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary({ currency: "USD" }))),
      http.get(opportunitiesUrl, () => listResponse([])),
    );
    renderList();

    await waitFor(() =>
      expect(within(card()).getByText("No hay oportunidades abiertas en USD.")).toBeInTheDocument(),
    );
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
  });
});
