import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { PipelineListPage } from "./PipelineListPage";
import { useUpdatePipeline } from "./mutations";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { Pipeline, PipelineListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: "u1", email: "a@x.com", fullName: "A", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/pipelines`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelineListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("PipelineListPage", () => {
  it("P10 loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: PipelineListResponse = {
      data: [makePipeline()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse)));

    renderPage();

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
  });

  it("P10b error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(baseUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("P10c empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay pipelines para mostrar.")).toBeInTheDocument(),
    );
  });

  it("P11 búsqueda/orden/paginación producen la query esperada", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    const listResponse: PipelineListResponse = {
      data: [makePipeline()],
      pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
    };
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(listResponse);
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Buscar por nombre"), "ventas");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("search")).toBe("ventas"));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "name");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("sortBy")).toBe("name"));

    await user.click(screen.getByText("Siguiente"));
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("page")).toBe("2"));
  });

  it("P12 isDefault se muestra correctamente por fila", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: PipelineListResponse = {
      data: [
        makePipeline({ id: "pl-a", name: "Ventas A", isDefault: true }),
        makePipeline({ id: "pl-b", name: "Ventas B", isDefault: false }),
      ],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    };
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse)));

    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas A")).toBeInTheDocument());
    const rowA = screen.getByText("Ventas A").closest("tr");
    const rowB = screen.getByText("Ventas B").closest("tr");
    expect(rowA).toHaveTextContent("Default");
    expect(rowB).not.toHaveTextContent("Default");
  });

  it("P13 USER no ve Nuevo pipeline / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    expect(screen.queryByText("Nuevo pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
  });

  it("P14 ADMIN sí ve Nuevo pipeline / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    expect(screen.getByText("Nuevo pipeline")).toBeInTheDocument();
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
  });

  it("P15 cancelar window.confirm no envía DELETE", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deleteCalled = false;
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${baseUrl}/:id`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteCalled).toBe(false);
  });

  it("P16 confirmar window.confirm envía DELETE al id correcto y termina sin error", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deletedId: string | undefined;
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline({ id: "pl-target" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${baseUrl}/:id`, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(deletedId).toBe("pl-target"));
    expect(screen.queryByText(/no pudimos eliminar/i)).not.toBeInTheDocument();
  });

  it("P17 DELETE del último pipeline activo muestra el 400 real del backend, visible y accesible", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "No se puede eliminar el último pipeline de la organización" } },
          { status: 400 },
        ),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se puede eliminar el último pipeline de la organización",
      ),
    );
  });

  it("P18a tras marcar otro pipeline como default, el que era default deja de mostrarse como tal sin refresh manual", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const store: Record<string, Pipeline> = {
      "pl-a": makePipeline({ id: "pl-a", name: "Ventas A", isDefault: true }),
      "pl-b": makePipeline({ id: "pl-b", name: "Ventas B", isDefault: false }),
    };
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: Object.values(store),
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      ),
      http.patch(`${baseUrl}/:id`, async ({ params, request }) => {
        const body = (await request.json()) as { isDefault?: boolean };
        const id = params.id as string;
        if (body.isDefault === true) {
          for (const key of Object.keys(store)) store[key].isDefault = false;
        }
        store[id] = { ...store[id], ...body };
        return HttpResponse.json(store[id]);
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText("Ventas A")).toBeInTheDocument());
    expect(screen.getByText("Ventas A").closest("tr")).toHaveTextContent("Default");

    const { result } = renderHook(() => useUpdatePipeline("pl-b"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ isDefault: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await waitFor(() =>
      expect(screen.getByText("Ventas B").closest("tr")).toHaveTextContent("Default"),
    );
    expect(screen.getByText("Ventas A").closest("tr")).not.toHaveTextContent("Default");
  });

  it("P18b desmarcar el único default actual deja la organización en cero defaults, reflejado tras refetch", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const store: Record<string, Pipeline> = {
      "pl-a": makePipeline({ id: "pl-a", name: "Ventas A", isDefault: true }),
    };
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: Object.values(store),
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.patch(`${baseUrl}/:id`, async ({ params, request }) => {
        const body = (await request.json()) as { isDefault?: boolean };
        const id = params.id as string;
        store[id] = { ...store[id], ...body };
        return HttpResponse.json(store[id]);
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() =>
      expect(screen.getByText("Ventas A").closest("tr")).toHaveTextContent("Default"),
    );

    const { result } = renderHook(() => useUpdatePipeline("pl-a"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ isDefault: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await waitFor(() =>
      expect(screen.getByText("Ventas A").closest("tr")).not.toHaveTextContent("Default"),
    );
    // Sin badge inventado en ninguna FILA de la tabla — cero defaults es un
    // estado real y válido, no un error a ocultar. (El header de columna
    // "Default" sigue presente; lo que no debe aparecer es el valor en
    // ninguna celda de datos.)
    const dataRows = screen.getAllByRole("row").slice(1);
    for (const row of dataRows) {
      expect(row).not.toHaveTextContent("Default");
    }
  });
});
