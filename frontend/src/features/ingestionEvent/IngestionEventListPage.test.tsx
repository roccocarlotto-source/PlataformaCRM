import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeIngestionEvent } from "../../test/ingestionEventFixtures";
import { makeSource } from "../../test/sourceFixtures";
import { IngestionEventListPage } from "./IngestionEventListPage";
import type { IngestionEventListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const eventsUrl = `${env.apiUrl}/api/ingestion-events`;
const sourcesUrl = `${env.apiUrl}/api/sources`;

function listResponse(
  overrides: Partial<IngestionEventListResponse> = {},
): IngestionEventListResponse {
  return {
    data: [makeIngestionEvent()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

function sourcesHandler(sources = [makeSource({ id: "src1", name: "Landing de precios" })]) {
  return http.get(sourcesUrl, () =>
    HttpResponse.json({
      data: sources,
      pagination: { page: 1, pageSize: 100, total: sources.length, totalPages: 1 },
    }),
  );
}

function detalleDeFuente() {
  return http.get(`${sourcesUrl}/:id`, ({ params }) =>
    HttpResponse.json(makeSource({ id: params.id as string, name: "Landing de precios" })),
  );
}

function renderPage(ruta = "/ingestion-events") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <IngestionEventListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IngestionEventListPage — listado", () => {
  it("muestra la fuente resuelta por nombre, el estado traducido y el motivo", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeIngestionEvent({
                id: "ev-fail",
                status: "FAILED",
                errorMessage: "email: email inválido",
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    await waitFor(() => expect(tabla.getByText("Landing de precios")).toBeInTheDocument());
    expect(tabla.getByText("Fallido")).toBeInTheDocument();
    expect(tabla.getByText("email: email inválido")).toBeInTheDocument();
    // El uuid de la fuente no se muestra: se resolvió a nombre.
    expect(tabla.queryByText("src1")).not.toBeInTheDocument();
  });

  it("un evento sin motivo muestra un guion, no una celda vacía", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({ data: [makeIngestionEvent({ status: "PENDING", errorMessage: null })] }),
        ),
      ),
    );

    renderPage();
    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getByText("Pendiente")).toBeInTheDocument();
    expect(tabla.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("no hace un request por fila: veinte eventos de la misma fuente resuelven una vez", async () => {
    let resoluciones = 0;
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => {
        resoluciones += 1;
        return HttpResponse.json(makeSource({ id: "src1", name: "Landing" }));
      }),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: Array.from({ length: 20 }, (_, i) =>
              makeIngestionEvent({ id: `ev${i}`, sourceId: "src1" }),
            ),
            pagination: { page: 1, pageSize: 20, total: 20, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();
    await screen.findByRole("table");
    await waitFor(() => expect(resoluciones).toBe(1));
  });

  it("estados de carga, error y vacío", async () => {
    server.use(
      sourcesHandler(),
      http.get(eventsUrl, () => new Promise(() => undefined)),
    );
    const { unmount } = renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    unmount();

    server.use(
      sourcesHandler(),
      http.get(eventsUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió" } }, { status: 500 }),
      ),
    );
    const segunda = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Se rompió");
    segunda.unmount();

    server.use(
      sourcesHandler(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("No hay eventos para mostrar.")).toBeInTheDocument();
  });
});

describe("IngestionEventListPage — filtros", () => {
  it("el filtro de estado viaja en la query y resetea la página", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.selectOptions(screen.getByLabelText("Estado"), "FAILED");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("status")).toBe("FAILED");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });
  });

  it("el filtro de fuente viene preseleccionado desde la URL (cross-link de Source)", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler([
        makeSource({ id: "src1", name: "Landing" }),
        makeSource({ id: "src2", name: "Feria" }),
      ]),
      detalleDeFuente(),
      http.get(eventsUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    renderPage("/ingestion-events?sourceId=src2");

    await waitFor(() => expect(urls[0]?.searchParams.get("sourceId")).toBe("src2"));
    await waitFor(() => expect(screen.getByLabelText("Fuente")).toHaveValue("src2"));
  });

  it("el filtro por batchId de la URL filtra y se anuncia en la pantalla", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    renderPage("/ingestion-events?batchId=batch-9");

    await waitFor(() => expect(urls[0]?.searchParams.get("batchId")).toBe("batch-9"));
    // Sin este aviso la lista parecería incompleta sin explicación.
    expect(screen.getByText("batch-9")).toBeInTheDocument();
  });

  it("cambiar la fuente NO descarta el filtro de lote: son independientes", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler([
        makeSource({ id: "src1", name: "Landing" }),
        makeSource({ id: "src2", name: "Feria" }),
      ]),
      detalleDeFuente(),
      http.get(eventsUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    const user = userEvent.setup();
    renderPage("/ingestion-events?batchId=batch-9");
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Fuente"), "src2");

    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("sourceId")).toBe("src2");
      expect(urls.at(-1)?.searchParams.get("batchId")).toBe("batch-9");
    });
  });

  it("no hay selector de 'Ordenar por': el backend solo acepta createdAt", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();
    await screen.findByRole("table");

    expect(screen.queryByLabelText("Ordenar por")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Orden")).toBeInTheDocument();
  });
});

describe("IngestionEventListPage — reintento y contacto promovido", () => {
  it("'Reintentar' SOLO aparece en las filas FAILED", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeIngestionEvent({ id: "ev-pend", status: "PENDING" }),
              makeIngestionEvent({ id: "ev-proc", status: "PROCESSED" }),
              makeIngestionEvent({ id: "ev-fail", status: "FAILED", errorMessage: "falló" }),
            ],
            pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();
    const tabla = within(await screen.findByRole("table"));
    // Tres filas, un solo botón.
    expect(tabla.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);
  });

  it("un reintento exitoso manda el POST del id correcto y refresca el listado", async () => {
    const reintentados: string[] = [];
    let llamadasAlListado = 0;
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () => {
        llamadasAlListado += 1;
        // Después del reintento el backend ya devuelve la fila en PENDING: es
        // lo que la invalidación trae, y lo que la pantalla tiene que mostrar.
        const status = llamadasAlListado === 1 ? "FAILED" : "PENDING";
        return HttpResponse.json(
          listResponse({
            data: [
              makeIngestionEvent({
                id: "ev-fail",
                status,
                errorMessage: status === "FAILED" ? "email inválido" : null,
              }),
            ],
          }),
        );
      }),
      http.post(`${eventsUrl}/:id/retry`, ({ params }) => {
        reintentados.push(params.id as string);
        return HttpResponse.json(makeIngestionEvent({ id: "ev-fail", status: "PENDING" }));
      }),
    );

    const user = userEvent.setup();
    renderPage();
    const tabla = within(await screen.findByRole("table"));

    await user.click(tabla.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(reintentados).toEqual(["ev-fail"]));

    // La invalidación recargó el listado y la fila ya no ofrece reintentar. Se
    // busca DENTRO de la tabla y se la vuelve a pedir en cada intento: "Pendiente"
    // también existe como <option> del filtro de estado, y el nodo de la tabla
    // se reemplaza al re-renderizar.
    await waitFor(() =>
      expect(within(screen.getByRole("table")).getByText("Pendiente")).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("table")).queryByRole("button", { name: "Reintentar" }),
    ).not.toBeInTheDocument();
  });

  it("un 409 por carrera perdida se muestra como error, sin romper la pantalla", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [makeIngestionEvent({ id: "ev-fail", status: "FAILED", errorMessage: "falló" })],
          }),
        ),
      ),
      http.post(`${eventsUrl}/:id/retry`, () =>
        HttpResponse.json(
          { error: { message: "Solo se puede reprocesar un evento FAILED (está en PENDING)" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    const tabla = within(await screen.findByRole("table"));
    await user.click(tabla.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText(/está en PENDING/)).toBeInTheDocument();
    // La tabla sigue en pie: el error es de la mutación, no de la pantalla.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("'Ver contacto' aparece SOLO cuando hay promotedContactId, y apunta a su edición", async () => {
    server.use(
      sourcesHandler(),
      detalleDeFuente(),
      http.get(eventsUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeIngestionEvent({ id: "ev-sin", status: "FAILED", promotedContactId: null }),
              makeIngestionEvent({
                id: "ev-con",
                status: "PROCESSED",
                promotedContactId: "ct-99",
              }),
            ],
            pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();
    const tabla = within(await screen.findByRole("table"));

    const links = tabla.getAllByRole("link", { name: "Ver contacto" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/contacts/ct-99/edit");
  });
});
