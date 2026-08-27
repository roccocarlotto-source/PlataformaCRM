import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeApiKey, makeCreatedApiKey } from "../../test/apiKeyFixtures";
import { makeSource } from "../../test/sourceFixtures";
import { ApiKeyListPage } from "./ApiKeyListPage";
import type { ApiKeyListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const keysUrl = `${env.apiUrl}/api/api-keys`;
const sourcesUrl = `${env.apiUrl}/api/sources`;

function listResponse(overrides: Partial<ApiKeyListResponse> = {}): ApiKeyListResponse {
  return {
    data: [makeApiKey()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

// El listado de fuentes alimenta los dos <select> (crear y filtrar).
function sourcesHandler(sources = [makeSource({ id: "src1", name: "Landing de precios" })]) {
  return http.get(sourcesUrl, () =>
    HttpResponse.json({
      data: sources,
      pagination: { page: 1, pageSize: 100, total: sources.length, totalPages: 1 },
    }),
  );
}

function renderPage(ruta = "/api-keys") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <ApiKeyListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ApiKeyListPage — listado", () => {
  it("resuelve el NOMBRE de la fuente, no el uuid", async () => {
    server.use(
      sourcesHandler(),
      http.get(keysUrl, () => HttpResponse.json(listResponse())),
      http.get(`${sourcesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeSource({ id: params.id as string, name: "Landing de precios" })),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    await waitFor(() => expect(tabla.getByText("Landing de precios")).toBeInTheDocument());
    expect(tabla.queryByText("src1")).not.toBeInTheDocument();
  });

  it("NO hace un request por fila: veinte claves de la misma fuente resuelven una sola vez", async () => {
    let resoluciones = 0;
    const claves = Array.from({ length: 20 }, (_, i) =>
      makeApiKey({ id: `ak${i}`, sourceId: "src1" }),
    );
    server.use(
      sourcesHandler(),
      http.get(keysUrl, () =>
        HttpResponse.json(
          listResponse({
            data: claves,
            pagination: { page: 1, pageSize: 20, total: 20, totalPages: 1 },
          }),
        ),
      ),
      http.get(`${sourcesUrl}/:id`, ({ params }) => {
        resoluciones += 1;
        return HttpResponse.json(makeSource({ id: params.id as string, name: "Landing" }));
      }),
    );

    renderPage();

    await screen.findByRole("table");
    await waitFor(() => expect(resoluciones).toBe(1));
  });

  it("una fuente que no resuelve muestra un guion, no rompe la fila", async () => {
    server.use(
      sourcesHandler(),
      http.get(keysUrl, () => HttpResponse.json(listResponse())),
      http.get(`${sourcesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    await waitFor(() => expect(tabla.getByText("—")).toBeInTheDocument());
    expect(tabla.getByText("crm_AbCdEfGh…")).toBeInTheDocument();
  });

  it("el estado se DERIVA de revokedAt, y una clave revocada no ofrece revocar", async () => {
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeApiKey({ id: "activa", revokedAt: null }),
              makeApiKey({ id: "revocada", revokedAt: "2026-02-02T00:00:00.000Z" }),
            ],
            pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getByText("Activa")).toBeInTheDocument();
    expect(tabla.getByText("Revocada")).toBeInTheDocument();
    // Dos filas, un solo botón: la revocada no lo ofrece.
    expect(tabla.getAllByRole("button", { name: "Revocar" })).toHaveLength(1);
  });

  it("el filtro por sourceId viene preseleccionado desde la URL (cross-link de Source)", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler([
        makeSource({ id: "src1", name: "Landing" }),
        makeSource({ id: "src2", name: "Feria" }),
      ]),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    renderPage("/api-keys?sourceId=src2");

    await waitFor(() => expect(urls[0]?.searchParams.get("sourceId")).toBe("src2"));
    // Y el select lo refleja, no queda en "Todas" mientras la lista está filtrada.
    await waitFor(() => expect(screen.getByLabelText("Fuente")).toHaveValue("src2"));
  });

  it("el filtro de estado viaja en la query", async () => {
    const urls: URL[] = [];
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Estado"), "REVOKED");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("status")).toBe("REVOKED"));
  });

  it("estados de carga, error y vacío", async () => {
    server.use(
      sourcesHandler(),
      http.get(keysUrl, () => new Promise(() => undefined)),
    );
    const { unmount } = renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    unmount();

    server.use(
      sourcesHandler(),
      http.get(keysUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió" } }, { status: 500 }),
      ),
    );
    const segunda = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Se rompió");
    segunda.unmount();

    server.use(
      sourcesHandler(),
      http.get(keysUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("No hay claves para mostrar.")).toBeInTheDocument();
  });
});

describe("ApiKeyListPage — creación y el secreto", () => {
  it("crear abre el modal con la clave en claro, y al cerrarlo DESAPARECE del DOM", async () => {
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () => HttpResponse.json(listResponse())),
      http.post(keysUrl, () =>
        HttpResponse.json(makeCreatedApiKey({ key: "crm_secreto_visible_una_vez" }), {
          status: 201,
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Fuente para la clave nueva"), "src1");
    await user.click(screen.getByRole("button", { name: "Crear clave" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Clave")).toHaveValue("crm_secreto_visible_una_vez");

    await user.click(screen.getByRole("button", { name: "Listo, ya la guardé" }));

    // No es solo que el modal se oculte: la clave no queda en NINGÚN lado del
    // árbol donde un test pueda encontrarla. Es la garantía de "una sola vez".
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue("crm_secreto_visible_una_vez")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("crm_secreto_visible_una_vez");
  });

  it("el botón de crear está deshabilitado sin fuente elegida", async () => {
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Crear clave" })).toBeDisabled();
  });

  it("un POST fallido muestra el error y NO abre el modal", async () => {
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () => HttpResponse.json(listResponse())),
      http.post(keysUrl, () =>
        HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Fuente para la clave nueva"), "src1");
    await user.click(screen.getByRole("button", { name: "Crear clave" }));

    expect(await screen.findByText(/No pudimos crear la clave/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ApiKeyListPage — revocación", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  function handlersBase(onDelete: () => Response) {
    return [
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () =>
        HttpResponse.json(listResponse({ data: [makeApiKey({ id: "ak7" })] })),
      ),
      http.delete(`${keysUrl}/:id`, () => onDelete()),
    ];
  }

  it("cancelar la confirmación NO llama al backend", async () => {
    let llamadas = 0;
    server.use(
      ...handlersBase(() => {
        llamadas += 1;
        return HttpResponse.json(makeApiKey());
      }),
    );
    confirmSpy.mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Revocar" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(llamadas).toBe(0);
  });

  it("confirmando manda el DELETE del id correcto", async () => {
    const borrados: string[] = [];
    server.use(
      sourcesHandler(),
      http.get(`${sourcesUrl}/:id`, () => HttpResponse.json(makeSource())),
      http.get(keysUrl, () =>
        HttpResponse.json(listResponse({ data: [makeApiKey({ id: "ak7" })] })),
      ),
      http.delete(`${keysUrl}/:id`, ({ params }) => {
        borrados.push(params.id as string);
        return HttpResponse.json(makeApiKey({ id: "ak7", revokedAt: "2026-02-02T00:00:00.000Z" }));
      }),
    );
    confirmSpy.mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Revocar" }));

    await waitFor(() => expect(borrados).toEqual(["ak7"]));
  });

  it("un 409 del backend se muestra con su mensaje", async () => {
    server.use(
      ...handlersBase(() =>
        HttpResponse.json({ error: { message: "Esta clave ya fue revocada" } }, { status: 409 }),
      ),
    );
    confirmSpy.mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Revocar" }));

    expect(await screen.findByText(/Esta clave ya fue revocada/)).toBeInTheDocument();
  });
});
