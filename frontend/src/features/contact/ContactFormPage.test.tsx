import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { edicionDeMe } from "../../test/edicionFixtures";
import { makeDefinicion } from "../../test/contactCustomFieldFixtures";
import { makeUser } from "../../test/userFixtures";
import { ContactFormPage } from "./ContactFormPage";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { formatDateOnly } from "../../design-system/detailFormat";
import { automotoraDeMe, clinicaDeMe } from "../../test/rubroFixtures";
import { makeVehiculoDeCliente } from "../../test/vehiculoDeClienteFixtures";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// El formulario preselecciona a quien crea a partir de useAuth().me (ítem 7
// de docs/frontend-cambios-pendientes.md). Se mockea por ruta de módulo, como
// en ContactListPage.test.tsx: "u1" es Ana Pérez en usersHandler(), así que
// el select puede mostrarla como seleccionada.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "ana@x.com",
      fullName: "Ana Pérez",
      organizationId: "org-1",
      role: "ADMIN",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth());
});

const contactsUrl = `${env.apiUrl}/api/contacts`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const usersUrl = `${env.apiUrl}/api/users`;

// UserSelect se monta SIEMPRE en este formulario (sin gating por texto, a
// diferencia de CompanySelect), así que dispara GET /api/users en todo test —
// y con onUnhandledRequest:"error" (test/setup.ts) un test sin este handler
// no falla de forma obvia: la query interna entra en error y UserSelect
// renderiza su propio <p role="alert">, que rompe cualquier getByRole("alert")
// del formulario por ambigüedad. Mismo criterio que baseHandlers() en
// OpportunityFormPage.test.tsx.
function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [
        makeUser({ id: "u1", fullName: "Ana Pérez" }),
        makeUser({ id: "u2", fullName: "Beto Díaz" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

// B6: la ficha consulta las definiciones de campos personalizados. Sin
// definiciones (lo normal en estos tests) la tarjeta no se muestra; los tests
// de B6 pasan las suyas a renderForm.
function customFieldsHandler(definiciones: unknown[]) {
  return http.get(`${env.apiUrl}/api/contact-custom-fields`, () => HttpResponse.json(definiciones));
}

function renderForm(initialPath: string, camposPersonalizados: unknown[] = []) {
  server.use(customFieldsHandler(camposPersonalizados));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/contacts/new" element={<ContactFormPage />} />
          <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
          <Route path="/contacts" element={<div>lista de contactos</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ContactFormPage", () => {
  it("create mode: no pide detail, submit usa create, navega tras el éxito", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makeContact());
      }),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeContact({ firstName: "Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    expect(getDetailCalled).toBe(false);

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    // ownerId viaja siempre en creación: es el usuario actual, preseleccionado
    // (ver el bloque ownerId más abajo).
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "LEAD",
      ownerId: "u1",
    });
  });

  it("create: el select Etapa muestra los rótulos traducidos y manda el valor interno del enum", async () => {
    // Ítem 9 de docs/frontend-cambios-pendientes.md: el texto de cada opción
    // sale de labels.ts, pero el value sigue siendo el enum crudo — es lo que
    // viaja en el payload.
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeContact(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    // El valor interno del enum ya no es observable en la fila (§46): lo que
    // garantiza que viaja intacto es el payload del POST, más abajo.
    expect(await listSelectOptions(user, screen.getByLabelText("Etapa"))).toEqual([
      "Nuevo",
      "Calificado (Marketing)",
      "Calificado (Ventas)",
      "Cliente",
      "Perdido",
    ]);

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Cliente");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "CUSTOMER",
      ownerId: "u1",
    });
  });

  it("edit mode: carga detail, hidrata companyId real, submit usa update sobre el id correcto, navega tras el éxito", async () => {
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: "Original",
            companyId: "co-1",
          }),
        ),
      ),
      http.get(`${companiesUrl}/:id`, ({ params }) =>
        params.id === "co-1"
          ? HttpResponse.json(makeCompany({ id: "co-1", name: "Acme Corp" }))
          : HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makeContact({ id: "ct1", firstName: "Editado" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Original"));
    // companyId real hidratado — se resuelve y muestra el nombre, no el UUID.
    await waitFor(() => expect(screen.getByText("Seleccionada: Acme Corp")).toBeInTheDocument());

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Editado");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(patchedId).toBe("ct1");
    expect(patchedBody).toMatchObject({ firstName: "Editado", companyId: "co-1" });
  });

  // «Cliente desde» (docs/importacion-de-datos.md §2.5): la fecha de alta en
  // el sistema anterior, de solo lectura, como día del calendario (sin correrla
  // por la zona del navegador). Sin el dato no aparece nada.
  it("importación: «Cliente desde» se muestra como día del calendario; sin el dato no aparece", async () => {
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: params.id === "ct1" ? "Importada" : "Manual",
            customerSince: params.id === "ct1" ? "2021-03-14T00:00:00.000Z" : null,
          }),
        ),
      ),
    );
    const { unmount } = renderForm("/contacts/ct1/edit");
    expect(await screen.findByText(/Cliente desde el 14\/03\/2021/)).toBeInTheDocument();
    unmount();
    renderForm("/contacts/ct2/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Manual"));
    expect(screen.queryByText(/Cliente desde/)).not.toBeInTheDocument();
  });

  // B6: la tarjeta "Campos personalizados" con un input por definición de la
  // organización; el PATCH manda { key: valor } y null para lo que se vació.
  it("B6: la ficha muestra los campos personalizados por tipo y el PATCH manda los valores (null al vaciar)", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: "Ana",
            customFields: { patente: "AB123CD", kilometros: 45000 },
          }),
        ),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact({ id: "ct1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit", [
      makeDefinicion({ id: "d1", key: "patente", label: "Patente", type: "TEXT" }),
      makeDefinicion({ id: "d2", key: "kilometros", label: "Kilómetros", type: "NUMBER" }),
      makeDefinicion({ id: "d3", key: "tiene_usado", label: "Tiene usado", type: "BOOLEAN" }),
      makeDefinicion({
        id: "d4",
        key: "combustible",
        label: "Combustible",
        type: "SELECT",
        options: ["Nafta", "Diésel"],
      }),
    ]);

    await waitFor(() => expect(screen.getByLabelText("Patente")).toHaveValue("AB123CD"));
    expect(screen.getByLabelText("Kilómetros")).toHaveValue(45000);
    expect(screen.getByLabelText("Tiene usado")).not.toBeChecked();

    await user.clear(screen.getByLabelText("Patente"));
    await user.click(screen.getByLabelText("Tiene usado"));
    await chooseSelectOption(user, screen.getByLabelText("Combustible"), "Diésel");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(patchedBody?.customFields).toEqual({
      patente: null,
      kilometros: 45000,
      tiene_usado: true,
      combustible: "Diésel",
    });
  });

  // Una opción que el contacto tenía elegida y después se eliminó de la
  // lista: la ficha la sigue mostrando, marcada, y no la ofrece como "Sin cargar".
  it("B6: una opción eliminada de la lista se muestra marcada y se conserva al guardar otro campo", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: "Ana",
            customFields: { forma_de_pago: "Permuta" },
          }),
        ),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact({ id: "ct1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit", [
      makeDefinicion({
        id: "d1",
        key: "forma_de_pago",
        label: "Forma de pago",
        type: "SELECT",
        options: ["Contado", "Financiado"],
      }),
    ]);

    await waitFor(() =>
      expect(screen.getByLabelText("Forma de pago")).toHaveValue("Permuta (opción eliminada)"),
    );
    expect(await listSelectOptions(user, screen.getByLabelText("Forma de pago"))).toEqual([
      "Sin cargar",
      "Contado",
      "Financiado",
      "Permuta (opción eliminada)",
    ]);
    await user.keyboard("{Escape}");

    // Se guarda otra cosa: el valor viejo viaja tal cual (el backend no lo
    // vuelve a validar porque no cambió).
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Ana María");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(patchedBody?.firstName).toBe("Ana María");
    expect(patchedBody?.customFields).toEqual({ forma_de_pago: "Permuta" });
  });

  // Selección múltiple: casillas en el orden de la definición; el valor es el
  // arreglo de las marcadas, y una opción eliminada que el contacto tenía se
  // muestra marcada al final.
  it("B6: una selección múltiple se edita con casillas y el PATCH manda el arreglo completo (null al desmarcar todas)", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: "Ana",
            customFields: { intereses: ["Usados", "Vieja"] },
          }),
        ),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact({ id: "ct1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit", [
      makeDefinicion({
        id: "d1",
        key: "intereses",
        label: "Intereses",
        type: "MULTI_SELECT",
        options: ["0 km", "Usados", "Financiación"],
      }),
    ]);

    const grupo = await screen.findByRole("group", { name: "Intereses" });
    const casillas = within(grupo).getAllByRole("checkbox");
    expect(casillas.map((c) => c.closest("label")?.textContent)).toEqual([
      "0 km",
      "Usados",
      "Financiación",
      "Vieja (opción eliminada)",
    ]);
    expect(within(grupo).getByLabelText("0 km")).not.toBeChecked();
    expect(within(grupo).getByLabelText("Usados")).toBeChecked();
    expect(within(grupo).getByLabelText("Vieja (opción eliminada)")).toBeChecked();

    // Marcar una, desmarcar la eliminada: viaja el arreglo entero, en el
    // orden de la definición.
    await user.click(within(grupo).getByLabelText("Financiación"));
    await user.click(within(grupo).getByLabelText("Vieja (opción eliminada)"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(patchedBody?.customFields).toEqual({ intereses: ["Usados", "Financiación"] });
  });

  it("vehículo de interés: una unidad dada de baja se sigue mostrando con su estado, la del agente lo dice, y Quitar manda null", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json(
          makeContact({
            id: "ct1",
            vehicleOfInterestId: "v-1",
            vehicleOfInterestSetBy: "AGENT",
            vehicleOfInterest: {
              id: "v-1",
              internalCode: "STK-0001",
              make: "Toyota",
              model: "Hilux",
              trim: "SRV",
              year: 2022,
              status: "SOLD",
              deletedAt: "2026-10-01T00:00:00.000Z",
            },
          }),
        ),
      ),
      // Dada de baja: el GET por id ya no la devuelve.
      http.get(`${env.apiUrl}/api/vehicles/:id`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact({ id: "ct1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    expect(await screen.findByText(/Toyota Hilux 2022 SRV/)).toBeInTheDocument();
    expect(screen.getByText("Vendido")).toBeInTheDocument();
    expect(screen.getByText(/dada de baja del stock/)).toBeInTheDocument();
    expect(screen.getByText(/La anotó el agente/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quitar" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.vehicleOfInterestId).toBeNull();
  });

  it("vehículo de interés: en creación no se muestra", async () => {
    server.use(usersHandler());
    renderForm("/contacts/new");
    await screen.findByLabelText("Nombre");
    expect(screen.queryByText("Vehículo de interés")).toBeNull();
  });

  // D2 (OPUS-I-03, docs-privados, local): un USER crea y edita lo suyo; no
  // reasigna, no une, y el contacto de otro lo ve sin poder guardarlo.
  it("USER: en creación no ve el selector Asignado (queda a su nombre) y el POST sale sin otro dueño", async () => {
    const auth = mockAuth();
    useAuthMock.mockReturnValue({ ...auth, me: { ...auth.me!, role: "USER" } });
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(contactsUrl, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact({ id: "c-nuevo" }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/contacts/new");

    expect(screen.queryByLabelText("Asignado")).not.toBeInTheDocument();
    expect(screen.queryByText("Unir con otro contacto")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nombre/), "Diego");
    await user.type(screen.getByLabelText(/Apellido/), "Ramírez");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    // Su propio id, o nada: el backend lo deja a su nombre igual.
    expect([undefined, "u1"]).toContain(body?.ownerId);
  });

  it("USER: el contacto de otro vendedor se ve, pero Guardar queda deshabilitado y lo dice", async () => {
    const auth = mockAuth();
    useAuthMock.mockReturnValue({ ...auth, me: { ...auth.me!, role: "USER" } });
    server.use(
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: "otro-vendedor" })),
      ),
    );
    renderForm("/contacts/c1/edit");

    expect(await screen.findByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByText(/asignado a otra persona/)).toBeInTheDocument();
    expect(screen.queryByText("Unir con otro contacto")).not.toBeInTheDocument();
  });

  it("USER: su propio contacto se edita con normalidad", async () => {
    const auth = mockAuth();
    useAuthMock.mockReturnValue({ ...auth, me: { ...auth.me!, role: "USER" } });
    server.use(
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: "u1" })),
      ),
    );
    renderForm("/contacts/c1/edit");

    expect(await screen.findByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(screen.queryByText(/asignado a otra persona/)).not.toBeInTheDocument();
  });

  it("error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("409 por email duplicado se muestra visible y no navega", async () => {
    server.use(
      usersHandler(),
      http.post(contactsUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un contacto con ese email en esta organización" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.type(screen.getByLabelText("Email"), "dup@example.com");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe un contacto con ese email en esta organización",
      ),
    );
    expect(screen.queryByText("lista de contactos")).not.toBeInTheDocument();
  });

  it("error genérico de mutation se muestra visible y no navega", async () => {
    server.use(
      usersHandler(),
      http.post(contactsUrl, () =>
        HttpResponse.json({ error: { message: "no se pudo crear" } }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo crear"));
    expect(screen.queryByText("lista de contactos")).not.toBeInTheDocument();
  });

  it("firstName y lastName son requeridos (validación HTML5 mínima)", async () => {
    // Este test no necesitaba NINGÚN handler antes de que el formulario
    // tuviera UserSelect: CompanySelect no busca hasta que se escribe algo,
    // así que montar la página no pegaba a la red. UserSelect sí lo hace de
    // entrada, y sin handler esa request quedaba sin atender — con
    // onUnhandledRequest:"error" no rompe este test, pero deja un unhandled
    // rejection a nivel de corrida que puede ensuciar a los demás.
    server.use(usersHandler());
    renderForm("/contacts/new");

    const firstName = screen.getByLabelText("Nombre") as HTMLInputElement;
    const lastName = screen.getByLabelText("Apellido") as HTMLInputElement;

    expect(firstName).toBeRequired();
    expect(lastName).toBeRequired();

    // Se espera a que la query de usuarios resuelva antes de terminar: si el
    // test corta con la request en vuelo, el afterEach resetea los handlers y
    // la respuesta aterriza sin nadie que la atienda.
    await waitFor(() => expect(screen.getByLabelText("Asignado")).toBeInTheDocument());
  });

  // -------------------------------------------------------------------------
  // ownerId — el gap de M3 cerrado (ver el comentario de ContactFormPage.tsx).
  // -------------------------------------------------------------------------

  it("create: elegir un asignado lo manda en el POST", async () => {
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeContact(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    // El combobox recien existe cuando la query de usuarios resolvio: UserSelect
    // no renderiza nada hasta isSuccess.
    await waitFor(() => expect(screen.getByLabelText("Asignado")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Asignado"), "Beto Díaz");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "LEAD",
      ownerId: "u2",
    });
  });

  it("create: el asignado arranca preseleccionado en quien crea, sin opción 'por defecto', y viaja en el POST", async () => {
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeContact(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Con");
    await user.type(screen.getByLabelText("Apellido"), "Duenio");
    // Ítem 7 de docs/frontend-cambios-pendientes.md: el usuario actual ("u1",
    // Ana Pérez) ya está marcado, y la antigua opción "Asignado a quien crea
    // (por defecto)" —que decía lo mismo que elegirse a uno mismo— no existe
    // más. Tampoco hay opción vacía de ningún tipo mientras haya un valor.
    await waitFor(() => expect(screen.getByLabelText("Asignado")).toHaveValue("Ana Pérez"));
    // Abrir el panel muestra solo usuarios: ninguna fila vacía.
    expect(await listSelectOptions(user, screen.getByLabelText("Asignado"))).toEqual([
      "Ana Pérez",
      "Beto Díaz",
    ]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    // El id viaja explícito. createContact llama al MISMO resolveOwnerId que
    // createCompany y haría lo mismo (actorUserId) si no se mandara nada.
    expect(postedBody).toEqual({
      firstName: "Con",
      lastName: "Duenio",
      lifecycleStage: "LEAD",
      ownerId: "u1",
    });
  });

  it("edit: hidrata el asignado existente en el selector, sin opción vacía", async () => {
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: "u2" })),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Asignado")).toHaveValue("Beto Díaz"));
    // Con un dueño real, "Sin asignar" no se ofrece: el PATCH no podría
    // limpiar ownerId de todos modos (chequeo truthy en contact.service.ts).
    expect(await listSelectOptions(user, screen.getByLabelText("Asignado"))).toEqual([
      "Ana Pérez",
      "Beto Díaz",
    ]);
  });

  it("edit: un contacto SIN asignado muestra 'Sin asignar', no al usuario actual ni un valor inventado", async () => {
    // Contact.ownerId es nullable, a diferencia de Opportunity.ownerId, y por
    // eso la hidratacion hace ?? undefined. Sin eso, un null llegaria al
    // select como value={null} y React lo pasaria a no controlado, con la
    // primera opcion de la lista seleccionada de hecho: el formulario
    // mostraria un dueno que el contacto no tiene.
    //
    // Y a diferencia de crear, acá NO se preselecciona a quien edita: el
    // backend solo autoasigna al crear, nunca al editar (el update toca
    // ownerId solo si viene truthy), así que guardar sin tocar el campo deja
    // el contacto sin dueño — "Sin asignar" es literal.
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: null })),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    // waitFor también sobre Asignado, y no es cosmético: desde que los valores
    // se derivan en render (lib/useFormDraft.ts) en vez de sembrarse con un
    // efecto, "Nombre" ya tiene su valor un ciclo ANTES — el efecto forzaba un
    // render extra que este assert aprovechaba sin decirlo para que la query de
    // usuarios llegara a resolver. UserSelect no renderiza el combobox hasta
    // isSuccess, así que hay que esperarlo explícitamente.
    await waitFor(() => expect(screen.getByLabelText("Asignado")).toHaveValue(""));
    // Sin valor, "Sin asignar" es el placeholder cerrado y la fila vacía
    // (primera y marcada) al abrir.
    expect(screen.getByLabelText("Asignado")).toHaveAttribute("placeholder", "Sin asignar");
    expect(await listSelectOptions(user, screen.getByLabelText("Asignado"))).toEqual([
      "Sin asignar",
      "Ana Pérez",
      "Beto Díaz",
    ]);
    expect(screen.getByRole("option", { name: "Sin asignar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md.
  it("Nombre y Apellido llevan la marca de obligatorio y la referencia del asterisco va una sola vez, junto a Guardar", async () => {
    server.use(usersHandler());
    renderForm("/contacts/new");

    for (const label of ["Nombre", "Apellido"]) {
      expect(screen.getByLabelText(label)).toBeRequired();
      expect(screen.getByText(label)).toHaveClass("ds-required");
    }
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);
  });
});

// Ítem 185: la marca "sin interés" se ve en la ficha y se pone o se quita a
// mano con un PATCH propio (noInterest), sin pasar por Guardar.
describe("ContactFormPage — sin interés (ítem 185)", () => {
  it("con la marca muestra el badge con la fecha y la nota, y «Quitar» manda noInterest: false", async () => {
    let patchedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json(
          makeContact({
            id: "ct1",
            noInterestAt: "2026-10-08T15:00:00.000Z",
            noInterestNote: "ya compró en otro lado",
          }),
        ),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(makeContact({ id: "ct1", noInterestAt: null }));
      }),
    );
    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    const aviso = await screen.findByRole("status");
    expect(within(aviso).getByText("Sin interés")).toBeInTheDocument();
    expect(aviso).toHaveTextContent("«ya compró en otro lado»");
    expect(aviso).toHaveTextContent(new Date("2026-10-08T15:00:00.000Z").toLocaleDateString());

    await user.click(screen.getByRole("button", { name: "Quitar «sin interés»" }));
    await waitFor(() => expect(patchedBody).toEqual({ noInterest: false }));
  });

  it("sin la marca, «Marcar sin interés» confirma y manda noInterest: true", async () => {
    let patchedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(
          makeContact({ id: "ct1", noInterestAt: "2026-10-08T15:00:00.000Z" }),
        );
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    expect(screen.queryByText("Sin interés")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Marcar sin interés" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/sin interés/));
    await waitFor(() => expect(patchedBody).toEqual({ noInterest: true }));
    confirmSpy.mockRestore();
  });
});

// Borrado de datos personales a pedido del titular: solo ADMIN, con
// confirmación (irreversible); después, cuándo y quién, y el formulario con lo
// anonimizado (no con lo que se borró).
describe("ContactFormPage — borrar datos personales", () => {
  it("ADMIN: confirma, borra y la ficha muestra cuándo y quién, con el formulario ya anonimizado", async () => {
    let borrado = false;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json(
          borrado
            ? makeContact({
                id: "ct1",
                firstName: "[dato borrado]",
                lastName: "[dato borrado]",
                email: null,
                phone: null,
                personalDataErasedAt: "2026-10-12T15:00:00.000Z",
                personalDataErasedBy: { id: "u1", fullName: "Ana Pérez" },
                personalDataErasePending: null,
              })
            : makeContact({ id: "ct1" }),
        ),
      ),
      http.post(`${contactsUrl}/:id/erase-personal-data`, () => {
        borrado = true;
        return HttpResponse.json({
          contactId: "ct1",
          mensajesBorrados: 2,
          conversacionesCerradas: 1,
          actividadesBorradas: 1,
          eventosDeGoogleLimpiados: 0,
          pendientes: [],
        });
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    await user.click(screen.getByRole("button", { name: "Borrar datos personales" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/No se puede deshacer/));
    // La fecha con el mismo formateador de la pantalla: depende del locale
    // del entorno (en el CI sale "10/12/2026").
    expect(
      await screen.findByText(
        `Datos personales borrados el ${formatDateOnly("2026-10-12T15:00:00.000Z")} por Ana Pérez.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("[dato borrado]");
    expect(screen.queryByRole("button", { name: "Borrar datos personales" })).toBeNull();
    confirmSpy.mockRestore();
  });

  it("si no confirma, no se borra nada", async () => {
    let llamado = false;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      http.post(`${contactsUrl}/:id/erase-personal-data`, () => {
        llamado = true;
        return HttpResponse.json({});
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    await user.click(screen.getByRole("button", { name: "Borrar datos personales" }));
    expect(llamado).toBe(false);
    confirmSpy.mockRestore();
  });

  it("USER: no ve el botón", async () => {
    const auth = mockAuth();
    useAuthMock.mockReturnValue({ ...auth, me: { ...auth.me!, role: "USER" } });
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json(makeContact({ id: "ct1", ownerId: "u1" })),
      ),
    );
    renderForm("/contacts/ct1/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    expect(screen.queryByRole("button", { name: "Borrar datos personales" })).toBeNull();
  });

  it("lo que Google no pudo limpiar se muestra como pendiente", async () => {
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json(
          makeContact({
            id: "ct1",
            personalDataErasedAt: "2026-10-12T15:00:00.000Z",
            personalDataErasedBy: { id: "u1", fullName: "Ana Pérez" },
            personalDataErasePending: [
              {
                bookingId: "b1",
                motivo: "Google no aceptó el cambio: el evento sigue con el nombre",
              },
            ],
          }),
        ),
      ),
    );
    renderForm("/contacts/ct1/edit");
    expect(
      await screen.findByText(/No se pudo sacar el nombre de 1 evento de Google Calendar/),
    ).toBeInTheDocument();
  });

  // Con los datos borrados la ficha queda en solo lectura (el backend responde
  // 409 a editar, cupón, sin interés y unir): sin esos botones, sin Guardar y
  // con los campos deshabilitados. En los dos rubros.
  describe.each([
    ["clínica", clinicaDeMe],
    ["automotora", automotoraDeMe],
  ] as const)("%s: un contacto con los datos borrados queda en solo lectura", (_, deMe) => {
    it("sin Guardar, Crear cupón, Marcar sin interés ni Unir, y con los campos deshabilitados", async () => {
      const base = mockAuth();
      useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...deMe("COMPLETA") } });
      server.use(
        usersHandler(),
        http.get(`${contactsUrl}/:id`, () =>
          HttpResponse.json(
            makeContact({
              id: "ct1",
              firstName: "[dato borrado]",
              lastName: "[dato borrado]",
              email: null,
              phone: null,
              personalDataErasedAt: "2026-10-12T15:00:00.000Z",
              personalDataErasedBy: { id: "u1", fullName: "Ana Pérez" },
              personalDataErasePending: null,
            }),
          ),
        ),
      );
      renderForm("/contacts/ct1/edit");

      expect(
        await screen.findByText(
          `Datos personales borrados el ${formatDateOnly("2026-10-12T15:00:00.000Z")} por Ana Pérez.`,
        ),
      ).toBeInTheDocument();
      for (const boton of [
        "Guardar",
        "Crear cupón",
        "Marcar sin interés",
        "Unir con otro contacto",
        "Borrar datos personales",
      ]) {
        expect(screen.queryByRole("button", { name: boton }), boton).toBeNull();
      }
      expect(screen.getByLabelText("Nombre")).toBeDisabled();
      expect(screen.getByLabelText("Apellido")).toBeDisabled();
    });

    it("el mismo contacto sin borrar se edita como siempre", async () => {
      const base = mockAuth();
      useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...deMe("COMPLETA") } });
      server.use(
        usersHandler(),
        http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      );
      renderForm("/contacts/ct1/edit");

      await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
      expect(screen.getByLabelText("Nombre")).toBeEnabled();
      for (const boton of [
        "Guardar",
        "Crear cupón",
        "Marcar sin interés",
        "Unir con otro contacto",
      ]) {
        expect(screen.getByRole("button", { name: boton }), boton).toBeEnabled();
      }
    });
  });
});

// Ediciones (docs/ediciones.md §2.2, paso E1): ESENCIAL no tiene empresas.
describe("ContactFormPage — por edición", () => {
  function conEdicion(edition: "COMPLETA" | "ESENCIAL") {
    const base = mockAuth();
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...edicionDeMe(edition) } });
  }

  it("ESENCIAL: sin el selector de empresa, y el alta no manda companyId", async () => {
    conEdicion("ESENCIAL");
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      usersHandler(),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeContact(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(await screen.findByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(postedBody).not.toHaveProperty("companyId");
  });

  it("COMPLETA: el selector de empresa está como siempre", async () => {
    conEdicion("COMPLETA");
    server.use(usersHandler());
    renderForm("/contacts/new");
    expect(await screen.findByLabelText("Empresa")).toBeInTheDocument();
  });

  // Puesto es el cargo EN una empresa: solo con una elegida (2026-10-14).
  it("Puesto: no aparece sin empresa ni en ESENCIAL", async () => {
    conEdicion("ESENCIAL");
    server.use(usersHandler());
    const { unmount } = renderForm("/contacts/new");
    expect(await screen.findByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.queryByLabelText("Puesto")).not.toBeInTheDocument();
    unmount();

    conEdicion("COMPLETA");
    renderForm("/contacts/new");
    expect(await screen.findByLabelText("Empresa")).toBeInTheDocument();
    expect(screen.queryByLabelText("Puesto")).not.toBeInTheDocument();
  });

  it("Puesto: aparece con empresa; sin empresa se oculta pero el valor se conserva al guardar", async () => {
    conEdicion("COMPLETA");
    let patchedBody: Record<string, unknown> | undefined;
    const conEmpresa = makeContact({ id: "ct1", companyId: "co-1", jobTitle: "Gerente" });
    const sinEmpresa = makeContact({ id: "ct2", companyId: null, jobTitle: "Gerente" });
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(params.id === "ct1" ? conEmpresa : sinEmpresa),
      ),
      http.get(`${companiesUrl}/:id`, () =>
        HttpResponse.json(makeCompany({ id: "co-1", name: "Acme Corp" })),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sinEmpresa);
      }),
    );
    const { unmount } = renderForm("/contacts/ct1/edit");
    expect(await screen.findByLabelText("Puesto")).toHaveValue("Gerente");
    unmount();

    const user = userEvent.setup();
    renderForm("/contacts/ct2/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(sinEmpresa.firstName));
    expect(screen.queryByLabelText("Puesto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(patchedBody).toBeDefined());
    // Oculto no es borrado: el PATCH no lo vacía.
    expect(patchedBody?.jobTitle === undefined || patchedBody?.jobTitle === "Gerente").toBe(true);
  });
});

// docs/servicios.md §4.6 y §13.1: la tarjeta Vehículos solo con el módulo
// Servicios. Sin él, la ficha no la monta ni pide nada a /api/servicios (MSW
// corre con onUnhandledRequest: "error": un pedido sin handler rompe el test).
describe("ContactFormPage — tarjeta Vehículos del taller", () => {
  it("sin el módulo: no hay tarjeta y no se llama a /api/servicios", async () => {
    let pidioServicios = false;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      http.get(`${env.apiUrl}/api/servicios/*`, () => {
        pidioServicios = true;
        return HttpResponse.json({}, { status: 403 });
      }),
    );
    const base = mockAuth();
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...automotoraDeMe("COMPLETA") } });
    renderForm("/contacts/ct1/edit");
    await screen.findByDisplayValue(makeContact().firstName);
    expect(screen.queryByRole("heading", { name: "Vehículos" })).toBeNull();
    expect(pidioServicios).toBe(false);
  });

  it("con el módulo: lista sus vehículos y ofrece agregar uno con este dueño", async () => {
    let contactIdPedido: string | null = null;
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      http.get(`${env.apiUrl}/api/servicios/vehiculos`, ({ request }) => {
        contactIdPedido = new URL(request.url).searchParams.get("contactId");
        return HttpResponse.json({
          data: [makeVehiculoDeCliente({ contactId: "ct1" })],
          pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        });
      }),
    );
    const base = mockAuth();
    const automotora = automotoraDeMe("COMPLETA");
    useAuthMock.mockReturnValue({
      ...base,
      me: { ...base.me!, ...automotora, modulos: [...(automotora.modulos ?? []), "servicios"] },
    });
    renderForm("/contacts/ct1/edit");
    expect(await screen.findByRole("heading", { name: "Vehículos" })).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Toyota Hilux 2020 · SBC 1001" }),
    ).toHaveAttribute("href", "/taller/vehiculos/cv1");
    expect(screen.getByRole("link", { name: "Agregar vehículo" })).toHaveAttribute(
      "href",
      "/taller/vehiculos/nuevo?contactId=ct1",
    );
    expect(contactIdPedido).toBe("ct1");
  });
});

// Latencia: las tarjetas de la ficha (campos personalizados, cupones,
// vehículos del taller) y el selector de usuario dependen solo del id de la
// URL. Se piden en paralelo con el contacto, no cuando el contacto llega.
describe("ContactFormPage — pedidos en paralelo", () => {
  it("pide las tarjetas y los usuarios sin esperar al contacto, y cada cosa una sola vez", async () => {
    const pedidos: string[] = [];
    let seguir: () => void = () => {};
    const resto = new Promise<void>((resolve) => {
      seguir = resolve;
    });
    const anotar = (que: string) => {
      pedidos.push(que);
      if (["campos", "cupones", "usuarios", "vehiculos"].every((q) => pedidos.includes(q))) {
        seguir();
      }
    };
    server.use(
      http.get(usersUrl, () => {
        anotar("usuarios");
        return HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
      http.get(`${contactsUrl}/:id/vouchers`, () => {
        anotar("cupones");
        return HttpResponse.json({ data: [] });
      }),
      http.get(`${env.apiUrl}/api/servicios/vehiculos`, () => {
        anotar("vehiculos");
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
        });
      }),
      // El contacto no responde hasta que llegaron los otros cuatro: con la
      // precarga, llegan; sin ella, recién se pedirían al montarse la ficha.
      http.get(`${contactsUrl}/:id`, async () => {
        await Promise.race([resto, new Promise((r) => setTimeout(r, 1000))]);
        pedidos.push("contacto");
        return HttpResponse.json(makeContact({ id: "ct1" }));
      }),
    );
    const base = mockAuth();
    const automotora = automotoraDeMe("COMPLETA");
    useAuthMock.mockReturnValue({
      ...base,
      me: { ...base.me!, ...automotora, modulos: [...(automotora.modulos ?? []), "servicios"] },
    });
    server.use(
      http.get(`${env.apiUrl}/api/contact-custom-fields`, () => {
        anotar("campos");
        return HttpResponse.json([]);
      }),
    );
    // Con el staleTime de la app (lib/queryClient.ts): lo precargado no se
    // vuelve a pedir cuando la tarjeta se monta.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/contacts/ct1/edit"]}>
          <Routes>
            <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue(makeContact().firstName);
    expect(await screen.findByRole("heading", { name: "Vehículos" })).toBeInTheDocument();
    expect(pedidos.indexOf("contacto")).toBe(4);
    expect([...pedidos].sort()).toEqual(
      ["campos", "contacto", "cupones", "usuarios", "vehiculos"].sort(),
    );
  });
});
