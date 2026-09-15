import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { cellByHeader } from "../../test/cellByHeader";
import { makeCompany } from "../../test/companyFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { RecentDealsTable } from "./RecentDealsTable";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const companiesUrl = `${env.apiUrl}/api/companies`;

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RecentDealsTable />
    </QueryClientProvider>,
  );
}

function card() {
  return screen.getByLabelText("Oportunidades recientes");
}

function listResponse(data: ReturnType<typeof makeOpportunity>[]) {
  return HttpResponse.json({
    data,
    pagination: { page: 1, pageSize: 5, total: data.length, totalPages: data.length ? 1 : 0 },
  });
}

describe("RecentDealsTable", () => {
  it("pide las últimas 5 por createdAt desc, sin status ni ownerId, y resuelve la empresa por id", async () => {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return listResponse([
          makeOpportunity({ id: "op1", title: "Renovación anual", companyId: "co1" }),
          makeOpportunity({
            id: "op2",
            title: "Flota nueva",
            companyId: null,
            contactId: "ct1",
            status: "WON",
            amount: "9000.00",
            currency: "UYU",
          }),
        ]);
      }),
      http.get(`${companiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
      ),
    );
    renderTable();

    await waitFor(() => expect(within(card()).getByText("Renovación anual")).toBeInTheDocument());
    expect(captured).toHaveLength(1);
    expect(captured[0]?.get("sortBy")).toBe("createdAt");
    expect(captured[0]?.get("sortOrder")).toBe("desc");
    expect(captured[0]?.get("pageSize")).toBe("5");
    expect(captured[0]?.has("status")).toBe(false);
    expect(captured[0]?.has("ownerId")).toBe(false);

    const row1 = within(card()).getByText("Renovación anual").closest("tr");
    await waitFor(() => expect(cellByHeader(row1, "Empresa")).toHaveTextContent("Acme Corp"));
    expect(cellByHeader(row1, "Monto")).toHaveTextContent("1500.00 USD");
    expect(cellByHeader(row1, "Estado")).toHaveTextContent("Abierta");

    // Sin empresa: guion, nunca el id crudo; el status ganado con su Badge.
    const row2 = within(card()).getByText("Flota nueva").closest("tr");
    expect(cellByHeader(row2, "Empresa")).toHaveTextContent("—");
    expect(cellByHeader(row2, "Monto")).toHaveTextContent("9000.00 UYU");
    expect(cellByHeader(row2, "Estado")?.querySelector(".ds-badge--success")).toHaveTextContent(
      "Ganada",
    );
    expect(within(card()).queryByText("co1")).not.toBeInTheDocument();
    expect(within(card()).queryByText("ct1")).not.toBeInTheDocument();
  });

  it("loading, empty y error, cada uno por su lado", async () => {
    server.use(http.get(opportunitiesUrl, () => listResponse([])));
    renderTable();
    expect(within(card()).getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(card()).getByText("Todavía no hay oportunidades.")).toBeInTheDocument(),
    );
    expect(within(card()).queryByRole("table")).not.toBeInTheDocument();

    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderTable();
    await waitFor(() =>
      expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
        "No pudimos cargar las oportunidades recientes: caída",
      ),
    );
  });
});
