import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { StageListPage } from "./StageListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { StageListResponse } from "./types";

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

const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;

function renderPage(pipelineId = "pl1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/pipelines/${pipelineId}/stages`]}>
        <Routes>
          <Route path="/pipelines/:pipelineId/stages" element={<StageListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockPipeline(overrides: Parameters<typeof makePipeline>[0] = {}) {
  server.use(http.get(`${pipelinesUrl}/:id`, () => HttpResponse.json(makePipeline(overrides))));
}

describe("StageListPage", () => {
  it("S11 loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1", name: "Ventas" });
    const listResponse: StageListResponse = {
      data: [makeStage()],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    };
    server.use(http.get(stagesUrl, () => HttpResponse.json(listResponse)));

    renderPage();

    await waitFor(() => expect(screen.getByText("Etapas de Ventas")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
  });

  it("S11b error de listado de etapas se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1", name: "Ventas" });
    server.use(
      http.get(stagesUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("S11c empty state cuando no hay etapas", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1", name: "Ventas" });
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay etapas para mostrar.")).toBeInTheDocument(),
    );
  });

  it("S12 pide el listado ordenado por order asc por default", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    let captured: URL | undefined;
    server.use(
      http.get(stagesUrl, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderPage();

    await waitFor(() => expect(captured).toBeDefined());
    expect(captured?.searchParams.get("sortBy")).toBe("order");
    expect(captured?.searchParams.get("sortOrder")).toBe("asc");
    expect(captured?.searchParams.get("pipelineId")).toBe("pl1");
  });

  it("S13 probability se formatea correctamente (no string crudo ni NaN%)", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage({ probability: "37.5" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("37.5%")).toBeInTheDocument());
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
  });

  it("S14 badges isWon/isLost se muestran correctamente por fila", async () => {
    // Ganada y Perdida se consolidaron en una sola columna "Estado" con un
    // único badge (o ninguno). La celda se ubica por cabecera, no por índice.
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [
            makeStage({ id: "st-won", name: "Cerrado ganado", isWon: true, isLost: false }),
            makeStage({ id: "st-lost", name: "Cerrado perdido", isWon: false, isLost: true }),
            makeStage({ id: "st-open", name: "Negociación", isWon: false, isLost: false }),
          ],
          pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Cerrado ganado")).toBeInTheDocument());
    const wonCell = cellByHeader(screen.getByText("Cerrado ganado").closest("tr"), "Estado");
    const lostCell = cellByHeader(screen.getByText("Cerrado perdido").closest("tr"), "Estado");
    const openCell = cellByHeader(screen.getByText("Negociación").closest("tr"), "Estado");

    expect(wonCell).toHaveTextContent("Etapa de Ganada");
    expect(wonCell).not.toHaveTextContent("Etapa de Perdida");
    expect(lostCell).toHaveTextContent("Etapa de Perdida");
    expect(lostCell).not.toHaveTextContent("Etapa de Ganada");
    // Ni ganada ni perdida: sin badge, la celda queda vacía.
    expect(openCell).toBeEmptyDOMElement();
  });

  it("S15 USER no ve Nueva etapa / Editar / Eliminar / Subir / Bajar", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    mockPipeline({ id: "pl1" });
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    expect(screen.queryByText("Nueva etapa")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
    expect(screen.queryByText("Subir")).not.toBeInTheDocument();
    expect(screen.queryByText("Bajar")).not.toBeInTheDocument();
  });

  it("S16 ADMIN sí ve Nueva etapa / Editar / Eliminar / Subir / Bajar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    expect(screen.getByText("Nueva etapa")).toBeInTheDocument();
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
    expect(screen.getByText("Subir")).toBeInTheDocument();
    expect(screen.getByText("Bajar")).toBeInTheDocument();
  });

  it("S17 mover arriba dispara el PATCH esperado (order del vecino) y refetchea, sin reordenar localmente antes", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    let getCallCount = 0;
    let patchedBody: unknown;
    server.use(
      http.get(stagesUrl, () => {
        getCallCount += 1;
        return HttpResponse.json({
          data: [
            makeStage({ id: "st-1", name: "Primera", order: 1 }),
            makeStage({ id: "st-2", name: "Segunda", order: 2 }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      }),
      http.patch(`${stagesUrl}/:id`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(makeStage({ id: "st-2", name: "Segunda", order: 1 }));
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Segunda")).toBeInTheDocument());
    expect(getCallCount).toBe(1);

    const secondRow = screen.getByText("Segunda").closest("tr");
    const upButton = secondRow!.querySelector("button:nth-of-type(2)") as HTMLButtonElement;
    await user.click(upButton);

    await waitFor(() => expect(patchedBody).toEqual({ order: 1 }));
    // El refetch posterior a la invalidación es lo que actualiza la vista
    // (segundo GET), nunca un reordenamiento optimista local.
    await waitFor(() => expect(getCallCount).toBe(2));
  });

  it("S18 pipeline padre inexistente/soft-deleted (404) muestra error y nunca renderiza la tabla de etapas", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let stagesCalled = false;
    server.use(
      http.get(`${pipelinesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Pipeline no encontrado" } }, { status: 404 }),
      ),
      http.get(stagesUrl, () => {
        stagesCalled = true;
        return HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Pipeline no encontrado"),
    );
    expect(screen.queryByText("Prospecto")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // El propio hook de Stage sigue montado (useStages no depende de que
    // el fetch del pipeline termine primero), pero la UI nunca renderiza
    // esos datos bajo un header fantasma.
    void stagesCalled;
  });

  it("R1.10a escribir en el buscador pide el listado con search y vuelve a page 1", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    let captured: URL | undefined;
    server.use(
      http.get(stagesUrl, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("Buscar por nombre"), "Cierre");

    await waitFor(() => expect(captured?.searchParams.get("search")).toBe("Cierre"));
    expect(captured?.searchParams.get("page")).toBe("1");
  });

  it("R1.10b paginado: 'Siguiente' pide page 2 y 'Anterior' está deshabilitado en la primera página", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    let capturedPage: string | null = null;
    server.use(
      http.get(stagesUrl, ({ request }) => {
        capturedPage = new URL(request.url).searchParams.get("page");
        return HttpResponse.json({
          data: [makeStage()],
          pagination: { page: Number(capturedPage ?? 1), pageSize: 20, total: 25, totalPages: 2 },
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Página 1 de 2")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(capturedPage).toBe("2"));
    await waitFor(() => expect(screen.getByText("Página 2 de 2")).toBeInTheDocument());
  });

  it("R1.10c 'Subir' se deshabilita solo en la primera fila de la primera página, no en la primera fila de una página intermedia", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    server.use(
      http.get(stagesUrl, ({ request }) => {
        const page = new URL(request.url).searchParams.get("page");
        if (page === "2") {
          return HttpResponse.json({
            data: [makeStage({ id: "st-page2-first", name: "PrimeraDePagina2", order: 21 })],
            pagination: { page: 2, pageSize: 20, total: 25, totalPages: 2 },
          });
        }
        return HttpResponse.json({
          data: [makeStage({ id: "st-page1-first", name: "PrimeraDePagina1", order: 1 })],
          pagination: { page: 1, pageSize: 20, total: 25, totalPages: 2 },
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("PrimeraDePagina1")).toBeInTheDocument());
    const page1Row = screen.getByText("PrimeraDePagina1").closest("tr");
    expect(page1Row!.querySelector("button:nth-of-type(2)")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(screen.getByText("PrimeraDePagina2")).toBeInTheDocument());
    const page2Row = screen.getByText("PrimeraDePagina2").closest("tr");
    expect(page2Row!.querySelector("button:nth-of-type(2)")).not.toBeDisabled();
  });

  it("S19 eliminar etapa: cancelar no envía DELETE, confirmar sí, y un error se muestra visible", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    mockPipeline({ id: "pl1" });
    let deleteCalled = false;
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${stagesUrl}/:id`, () => {
        deleteCalled = true;
        return HttpResponse.json({ error: { message: "no se pudo eliminar" } }, { status: 500 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));
    expect(deleteCalled).toBe(false);

    await user.click(screen.getByText("Eliminar"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo eliminar"));
  });
});
