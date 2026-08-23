import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { CompanySelect } from "./CompanySelect";
import { companyKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/companies`;

function renderSelect(queryClient: QueryClient, value: string | undefined, onChange = vi.fn()) {
  render(
    <QueryClientProvider client={queryClient}>
      <CompanySelect id="test-company" label="Empresa" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("CompanySelect", () => {
  it("no dispara ningún request al montarse sin término de búsqueda", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 400)); // más que el debounce
    expect(requestCount).toBe(0);
  });

  it("busca server-side al tipear (debounced), sin precargar todas las Companies", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeCompany({ id: "co-1", name: "Acme Corp" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("search")).toBe("acme");
    // pageSize acotado — nunca "todas las Companies".
    expect(captured[0].searchParams.get("pageSize")).toBe("20");

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
  });

  it("al elegir un resultado, llama a onChange con el id y limpia el término", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ id: "co-1", name: "Acme Corp" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onChange = renderSelect(queryClient, undefined);

    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    expect(onChange).toHaveBeenCalledWith("co-1");
  });

  it("siembra companyKeys.detail(id) con los resultados de la búsqueda (list/detail cache)", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ id: "co-1", name: "Acme Corp" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    renderSelect(queryClient, undefined);
    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    await waitFor(() =>
      expect(queryClient.getQueryData(companyKeys.detail("co-1"))).toMatchObject({
        id: "co-1",
        name: "Acme Corp",
      }),
    );
  });

  it("si falla la resolución de la Company ya seleccionada, muestra un fallback humano y nunca el UUID crudo", async () => {
    server.use(
      http.get(`${baseUrl}/co-rota`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSelect(queryClient, "co-rota");

    await waitFor(() =>
      expect(
        screen.getByText(/No pudimos cargar la empresa seleccionada\./),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("co-rota")).not.toBeInTheDocument();
  });
});
