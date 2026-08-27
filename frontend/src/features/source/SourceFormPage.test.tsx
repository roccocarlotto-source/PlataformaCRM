import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeSource } from "../../test/sourceFixtures";
import { SourceFormPage } from "./SourceFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/sources`;

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición.
function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/sources/new" element={<SourceFormPage />} />
          <Route path="/sources/:id/edit" element={<SourceFormPage />} />
          <Route path="/sources" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SourceFormPage — creación", () => {
  it("el editor de mapeo aparece SOLO al elegir Importación de archivo", async () => {
    const user = userEvent.setup();
    renderForm("/sources/new");

    // WEBHOOK es el default: no hay mapeo que configurar.
    expect(screen.queryByText("Mapeo de columnas")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Tipo"), "FILE_IMPORT");
    expect(screen.getByText("Mapeo de columnas")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Tipo"), "WEBHOOK");
    expect(screen.queryByText("Mapeo de columnas")).not.toBeInTheDocument();
  });

  it("crea una fuente WEBHOOK sin mandar fieldMapping (el POST no lo acepta como null)", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSource(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/new");

    await user.type(screen.getByLabelText("Nombre"), "Landing de precios");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({ name: "Landing de precios", type: "WEBHOOK", isActive: true });
    // La clave NO está presente, ni siquiera como null.
    expect(Object.keys(body as object)).not.toContain("fieldMapping");
  });

  it("crea una FILE_IMPORT con el mapeo convertido a mapa plano", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSource({ type: "FILE_IMPORT" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/new");

    await user.type(screen.getByLabelText("Nombre"), "Planilla feria");
    await user.selectOptions(screen.getByLabelText("Tipo"), "FILE_IMPORT");

    await user.click(screen.getByRole("button", { name: "Agregar columna" }));
    await user.type(screen.getByLabelText("Columna del archivo"), "Nombre");
    await user.selectOptions(screen.getByLabelText("Campo del contacto"), "firstName");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Planilla feria",
      type: "FILE_IMPORT",
      isActive: true,
      fieldMapping: { Nombre: "firstName" },
    });
  });

  it("dos columnas al mismo destino: el error se muestra ANTES de llamar al backend", async () => {
    let llamadas = 0;
    server.use(
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeSource(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/new");

    await user.type(screen.getByLabelText("Nombre"), "Planilla");
    await user.selectOptions(screen.getByLabelText("Tipo"), "FILE_IMPORT");

    await user.click(screen.getByRole("button", { name: "Agregar columna" }));
    await user.click(screen.getByRole("button", { name: "Agregar columna" }));

    const encabezados = screen.getAllByLabelText("Columna del archivo");
    const destinos = screen.getAllByLabelText("Campo del contacto");
    await user.type(encabezados[0], "Nombre");
    await user.selectOptions(destinos[0], "firstName");
    await user.type(encabezados[1], "Nombre de pila");
    await user.selectOptions(destinos[1], "firstName");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mismo campo/);
    expect(llamadas).toBe(0);
  });

  it("se puede quitar una fila del mapeo", async () => {
    const user = userEvent.setup();
    renderForm("/sources/new");

    await user.selectOptions(screen.getByLabelText("Tipo"), "FILE_IMPORT");
    await user.click(screen.getByRole("button", { name: "Agregar columna" }));
    expect(screen.getAllByLabelText("Columna del archivo")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Quitar la fila 1 del mapeo" }));
    expect(screen.queryByLabelText("Columna del archivo")).not.toBeInTheDocument();
    expect(screen.getByText("No hay columnas mapeadas.")).toBeInTheDocument();
  });

  it("un error del backend se muestra sin perder lo cargado", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "name es requerido" } }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/sources/new");

    await user.type(screen.getByLabelText("Nombre"), "X");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("name es requerido");
    expect(screen.getByLabelText("Nombre")).toHaveValue("X");
  });
});

describe("SourceFormPage — edición", () => {
  it("el tipo se muestra pero está DESHABILITADO, con la razón a la vista", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeSource({ id: "s1", type: "FILE_IMPORT", name: "Feria" })),
      ),
    );

    renderForm("/sources/s1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Feria"));
    const tipo = screen.getByLabelText("Tipo");
    expect(tipo).toBeDisabled();
    expect(tipo).toHaveValue("FILE_IMPORT");
    expect(screen.getByText(/El tipo no se puede cambiar/)).toBeInTheDocument();
  });

  it("carga el mapeo persistido como filas y el PATCH no manda type", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeSource({
            id: "s1",
            type: "FILE_IMPORT",
            fieldMapping: { Nombre: "firstName", Mail: "email" },
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSource({ id: "s1", type: "FILE_IMPORT" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/s1/edit");

    await waitFor(() => expect(screen.getAllByLabelText("Columna del archivo")).toHaveLength(2));
    expect(screen.getAllByLabelText("Columna del archivo")[0]).toHaveValue("Nombre");
    expect(screen.getAllByLabelText("Campo del contacto")[0]).toHaveValue("firstName");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Landing de precios",
      isActive: true,
      fieldMapping: { Nombre: "firstName", Mail: "email" },
    });
    expect(Object.keys(body as object)).not.toContain("type");
  });

  it("quitar todas las filas manda fieldMapping: null, NO un objeto vacío", async () => {
    // El backend rechaza {} explícitamente ("para no mapear nada, omitilo o
    // mandá null"), así que esta es la única forma de vaciar el mapeo.
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeSource({ id: "s1", type: "FILE_IMPORT", fieldMapping: { Nombre: "firstName" } }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSource({ id: "s1", type: "FILE_IMPORT" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/s1/edit");

    await waitFor(() => expect(screen.getAllByLabelText("Columna del archivo")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Quitar la fila 1 del mapeo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect((body as { fieldMapping: unknown }).fieldMapping).toBeNull();
  });

  it("en una fuente WEBHOOK el PATCH ni menciona fieldMapping", async () => {
    // Mandar null sobre una WEBHOOK sería un 400: el chequeo de tipo del service
    // corre para cualquier valor distinto de undefined.
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeSource({ id: "s1", type: "WEBHOOK" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSource({ id: "s1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/sources/s1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Landing de precios"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(Object.keys(body as object)).not.toContain("fieldMapping");
  });

  it("estado de carga y estado de error al traer la fuente", async () => {
    server.use(http.get(`${baseUrl}/:id`, () => new Promise(() => undefined)));
    const { unmount } = renderForm("/sources/s1/edit");
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    unmount();

    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
      ),
    );
    renderForm("/sources/s1/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Fuente no encontrada");
  });
});
