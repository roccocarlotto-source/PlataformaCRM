import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { BranchSelect } from "./BranchSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/branches`;

function renderSelect(value: string | undefined, onChange = vi.fn(), emptyOptionLabel?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BranchSelect
        id="branch"
        label="Sucursal"
        value={value}
        onChange={onChange}
        emptyOptionLabel={emptyOptionLabel}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("BranchSelect", () => {
  it("pide pageSize:100, sortBy:name, sortOrder:asc — sin búsqueda de texto", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeBranch()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("name");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renderiza un <select> con las sucursales devueltas (solo las de la propia organización: eso lo garantiza el backend)", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makeBranch({ id: "b1", name: "Casa Central" }),
            makeBranch({ id: "b2", name: "Sucursal Pocitos" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Casa Central")).toBeInTheDocument());
    expect(screen.getByText("Sucursal Pocitos")).toBeInTheDocument();
    expect(screen.getByText("Elegir sucursal…")).toBeInTheDocument();
  });

  it("al elegir una sucursal, llama a onChange con su id", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeBranch({ id: "b1", name: "Casa Central" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Casa Central")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");

    expect(onChange).toHaveBeenCalledWith("b1");
  });

  it("con emptyOptionLabel custom, usa ese texto (el filtro del listado lo llama 'Todas')", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderSelect(undefined, vi.fn(), "Todas");

    await waitFor(() => expect(screen.getByText("Todas")).toBeInTheDocument());
    expect(screen.queryByText("Elegir sucursal…")).not.toBeInTheDocument();
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "se cayó" } }, { status: 500 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar las sucursales/)).toBeInTheDocument(),
    );
  });
});
