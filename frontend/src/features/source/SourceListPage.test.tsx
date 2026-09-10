import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeSource } from "../../test/sourceFixtures";
import { openActionsMenu } from "../../test/openActionsMenu";
import { SourceListPage } from "./SourceListPage";
import type { SourceListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/sources`;

function listResponse(overrides: Partial<SourceListResponse> = {}): SourceListResponse {
  return {
    data: [makeSource()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SourceListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SourceListPage", () => {
  it("muestra las columnas de la tabla con el tipo y el estado traducidos", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeSource({ id: "s1", name: "Landing", type: "WEBHOOK", isActive: true }),
              makeSource({
                id: "s2",
                name: "Feria",
                type: "FILE_IMPORT",
                isActive: false,
              }),
            ],
            pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();

    // Se busca DENTRO de la tabla: los mismos textos ("Webhook", "Importación
    // de archivo") existen también como <option> de los filtros, así que una
    // búsqueda global encontraría dos y no distinguiría el filtro del dato.
    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getByText("Landing")).toBeInTheDocument();
    expect(tabla.getByText("Webhook")).toBeInTheDocument();
    expect(tabla.getByText("Activa")).toBeInTheDocument();
    expect(tabla.getByText("Feria")).toBeInTheDocument();
    expect(tabla.getByText("Importación de archivo")).toBeInTheDocument();
    expect(tabla.getByText("Pausada")).toBeInTheDocument();
  });

  it("no gatea nada por rol: la pantalla entera es ADMIN-only por ruta", async () => {
    // A diferencia de CompanyListPage, acá NO hay un chequeo isAdmin: las cinco
    // rutas de /api/sources son ADMIN-only, lectura incluida, y la pantalla vive
    // dentro de AdminRoute. Las acciones se ven siempre.
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));
    renderPage();

    // "Nueva fuente" se renderiza sin esperar a la query, así que hay que
    // esperar a la TABLA antes de buscar las acciones por fila.
    const tabla = within(await screen.findByRole("table"));
    expect(screen.getByRole("link", { name: "Nueva fuente" })).toBeInTheDocument();
    // Las acciones de fila viven en el menú de 3 puntos (§8).
    await openActionsMenu(userEvent.setup());
    expect(tabla.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(tabla.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("los filtros viajan en la query y resetean la página a 1", async () => {
    const urls: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Landing de precios");

    // Se pasa a la página 2 y después se filtra: el filtro tiene que volver a 1.
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.selectOptions(screen.getByLabelText("Tipo"), "FILE_IMPORT");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("type")).toBe("FILE_IMPORT");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });

    await user.selectOptions(screen.getByLabelText("Estado"), "false");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("false"));

    await user.type(screen.getByLabelText("Buscar"), "feria");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("search")).toBe("feria"));
  });

  it("la paginación deshabilita Anterior en la primera página", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        ),
      ),
    );
    renderPage();

    await screen.findByText("Landing de precios");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
  });

  describe("eliminar", () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      confirmSpy = vi.spyOn(window, "confirm");
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it("pide confirmación y NO llama al backend si se cancela", async () => {
      let llamadas = 0;
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () => {
          llamadas += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(false);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Landing de precios");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(llamadas).toBe(0);
    });

    it("confirmando manda el DELETE del id correcto", async () => {
      const borrados: string[] = [];
      server.use(
        http.get(baseUrl, () =>
          HttpResponse.json(listResponse({ data: [makeSource({ id: "s9" })] })),
        ),
        http.delete(`${baseUrl}/:id`, ({ params }) => {
          borrados.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Landing de precios");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      await waitFor(() => expect(borrados).toEqual(["s9"]));
    });

    it("un DELETE fallido muestra el mensaje del backend", async () => {
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Landing de precios");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Fuente no encontrada");
    });
  });

  it("estado de carga", () => {
    server.use(http.get(baseUrl, () => new Promise(() => undefined)));
    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("estado de error, con el mensaje real del backend", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió todo" } }, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Se rompió todo");
  });

  it("estado vacío", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("No hay fuentes para mostrar.")).toBeInTheDocument();
  });
});

describe("SourceListPage — cross-links por fila", () => {
  // Los dos links no siguen el mismo criterio, y esa diferencia es la que se
  // prueba acá: "Ver claves" va en todas las filas porque un listado de claves
  // vacío es un resultado válido; "Importar archivo" solo en las FILE_IMPORT
  // porque importar contra otro tipo da un 400 garantizado (import.service.ts).

  // Las acciones de una fila solo existen en el DOM con su menú de 3 puntos
  // abierto (§8), y un menú abierto cierra al anterior: se recorre fila por
  // fila, ubicándola por nombre.
  async function menuDeFila(user: ReturnType<typeof userEvent.setup>, nombre: string) {
    const row = screen.getByText(nombre).closest("tr");
    await openActionsMenu(user, row);
    return within(row!);
  }

  function conFilas(sources: ReturnType<typeof makeSource>[]) {
    return http.get(baseUrl, () =>
      HttpResponse.json(
        listResponse({
          data: sources,
          pagination: { page: 1, pageSize: 20, total: sources.length, totalPages: 1 },
        }),
      ),
    );
  }

  it("una fila FILE_IMPORT muestra 'Importar archivo', apuntando a su propia ruta", async () => {
    server.use(conFilas([makeSource({ id: "src-file", name: "Feria", type: "FILE_IMPORT" })]));
    renderPage();

    await screen.findByRole("table");
    const fila = await menuDeFila(userEvent.setup(), "Feria");
    const link = fila.getByRole("menuitem", { name: "Importar archivo" });
    expect(link).toHaveAttribute("href", "/sources/src-file/import");
  });

  it("una fila WEBHOOK NO muestra 'Importar archivo'", async () => {
    server.use(conFilas([makeSource({ id: "src-hook", name: "Landing", type: "WEBHOOK" })]));
    renderPage();

    await screen.findByRole("table");
    const fila = await menuDeFila(userEvent.setup(), "Landing");
    expect(fila.queryByRole("menuitem", { name: "Importar archivo" })).not.toBeInTheDocument();
  });

  it("una fila EXTERNAL_DB tampoco lo muestra", async () => {
    server.use(conFilas([makeSource({ id: "src-db", name: "Base", type: "EXTERNAL_DB" })]));
    renderPage();

    await screen.findByRole("table");
    const fila = await menuDeFila(userEvent.setup(), "Base");
    expect(fila.queryByRole("menuitem", { name: "Importar archivo" })).not.toBeInTheDocument();
  });

  it("con las tres juntas, solo la FILE_IMPORT ofrece importar", async () => {
    server.use(
      conFilas([
        makeSource({ id: "src-hook", name: "Landing", type: "WEBHOOK" }),
        makeSource({ id: "src-file", name: "Feria", type: "FILE_IMPORT" }),
        makeSource({ id: "src-db", name: "Base", type: "EXTERNAL_DB" }),
      ]),
    );
    renderPage();

    await screen.findByRole("table");
    const user = userEvent.setup();
    const landing = await menuDeFila(user, "Landing");
    expect(landing.queryByRole("menuitem", { name: "Importar archivo" })).not.toBeInTheDocument();
    const feria = await menuDeFila(user, "Feria");
    expect(feria.getByRole("menuitem", { name: "Importar archivo" })).toHaveAttribute(
      "href",
      "/sources/src-file/import",
    );
    const base = await menuDeFila(user, "Base");
    expect(base.queryByRole("menuitem", { name: "Importar archivo" })).not.toBeInTheDocument();
  });

  it("'Ver claves' SÍ aparece en las tres, con el filtro por fuente en la URL", async () => {
    // El caso de contraste: sin esto, los tests de arriba no distinguirían
    // "el link correcto está condicionado" de "ningún link se renderiza".
    server.use(
      conFilas([
        makeSource({ id: "src-hook", name: "Landing", type: "WEBHOOK" }),
        makeSource({ id: "src-file", name: "Feria", type: "FILE_IMPORT" }),
        makeSource({ id: "src-db", name: "Base", type: "EXTERNAL_DB" }),
      ]),
    );
    renderPage();

    await screen.findByRole("table");
    const user = userEvent.setup();
    for (const [nombre, id] of [
      ["Landing", "src-hook"],
      ["Feria", "src-file"],
      ["Base", "src-db"],
    ]) {
      const fila = await menuDeFila(user, nombre);
      expect(fila.getByRole("menuitem", { name: "Ver claves" })).toHaveAttribute(
        "href",
        `/api-keys?sourceId=${id}`,
      );
    }
  });

  it("'Ver eventos' aparece en TODA fila, sin importar el tipo", async () => {
    // A diferencia de "Importar archivo": cualquier Source puede tener eventos
    // —un webhook los genera de a uno, una FILE_IMPORT por lote— así que el
    // listado filtrado siempre tiene sentido, aunque devuelva vacío.
    server.use(
      conFilas([
        makeSource({ id: "src-hook", name: "Landing", type: "WEBHOOK" }),
        makeSource({ id: "src-file", name: "Feria", type: "FILE_IMPORT" }),
        makeSource({ id: "src-db", name: "Base", type: "EXTERNAL_DB" }),
      ]),
    );
    renderPage();

    await screen.findByRole("table");
    const user = userEvent.setup();
    for (const [nombre, id] of [
      ["Landing", "src-hook"],
      ["Feria", "src-file"],
      ["Base", "src-db"],
    ]) {
      const fila = await menuDeFila(user, nombre);
      expect(fila.getByRole("menuitem", { name: "Ver eventos" })).toHaveAttribute(
        "href",
        `/ingestion-events?sourceId=${id}`,
      );
    }
  });
});
