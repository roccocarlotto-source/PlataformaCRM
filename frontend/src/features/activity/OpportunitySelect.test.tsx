import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { OpportunitySelect } from "./OpportunitySelect";
import { opportunityKeys } from "../opportunity/queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/opportunities`;

function renderSelect(queryClient: QueryClient, value: string | undefined, onChange = vi.fn()) {
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunitySelect id="activity-opportunity" label="Oportunidad" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("OpportunitySelect", () => {
  it("no dispara ningún request al montarse sin término de búsqueda (sin precarga)", async () => {
    let requestCount = 0;
    server.use(
      http.get(baseUrl, () => {
        requestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, undefined);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requestCount).toBe(0);
  });

  it("busca server-side al tipear (debounced), por título", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeOpportunity({ id: "op-1", title: "Renovación anual", status: "OPEN" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "renovación");

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("search")).toBe("renovación");
    expect(captured[0].searchParams.get("pageSize")).toBe("20");

    await waitFor(() =>
      expect(screen.getByText(/Renovación anual — OPEN — 1500\.00 USD/)).toBeInTheDocument(),
    );
  });

  it("loading mientras busca", async () => {
    server.use(
      http.get(baseUrl, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "x");

    await waitFor(() => expect(screen.getByText("Buscando…")).toBeInTheDocument());
  });

  it("error de búsqueda se muestra como alert", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "boom" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "x");

    await waitFor(() =>
      expect(screen.getByText("No pudimos buscar oportunidades.")).toBeInTheDocument(),
    );
  });

  it("empty state sin resultados", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "inexistente");

    await waitFor(() => expect(screen.getByText("Sin resultados.")).toBeInTheDocument());
  });

  it("al elegir un resultado, llama a onChange con el id y limpia el término", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ id: "op-1", title: "Renovación anual" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onChange = renderSelect(queryClient, undefined);

    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "renovación");
    await waitFor(() => expect(screen.getByText(/Renovación anual/)).toBeInTheDocument());
    await user.click(screen.getByText(/Renovación anual/));

    expect(onChange).toHaveBeenCalledWith("op-1");
  });

  it("siembra opportunityKeys.detail(id) con los resultados de la búsqueda", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ id: "op-1", title: "Renovación anual" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar oportunidad por título…"), "renovación");
    await waitFor(() => expect(screen.getByText(/Renovación anual/)).toBeInTheDocument());

    await waitFor(() =>
      expect(queryClient.getQueryData(opportunityKeys.detail("op-1"))).toMatchObject({
        id: "op-1",
        title: "Renovación anual",
      }),
    );
  });

  it("muestra la selección actual resolviéndola puntualmente, sin precargar el catálogo, y nunca el UUID crudo", async () => {
    let listRequestCount = 0;
    server.use(
      http.get(baseUrl, () => {
        listRequestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
      http.get(`${baseUrl}/op-1`, () =>
        HttpResponse.json(makeOpportunity({ id: "op-1", title: "Renovación anual" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, "op-1");

    await waitFor(() =>
      expect(screen.getByText(/Seleccionada:.*Renovación anual/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("op-1")).not.toBeInTheDocument();
    expect(listRequestCount).toBe(0);
  });

  it("si falla la resolución de la Opportunity ya seleccionada, muestra un fallback humano, nunca el UUID", async () => {
    server.use(
      http.get(`${baseUrl}/op-rota`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, "op-rota");

    await waitFor(() =>
      expect(
        screen.getByText(/No pudimos cargar la oportunidad seleccionada\./),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("op-rota")).not.toBeInTheDocument();
  });
});
