import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeUser } from "../../test/userFixtures";
import { ContactFormPage } from "./ContactFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

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

function renderForm(initialPath: string) {
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
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "LEAD",
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
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toBeInTheDocument());
  });

  // -------------------------------------------------------------------------
  // ownerId — el gap de M3 cerrado (ver el comentario de ContactFormPage.tsx).
  // -------------------------------------------------------------------------

  it("create: elegir un propietario lo manda en el POST", async () => {
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
    // El select recien existe cuando la query de usuarios resolvio: UserSelect
    // no renderiza nada hasta isSuccess.
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Propietario"), "u2");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "LEAD",
      ownerId: "u2",
    });
  });

  it("create: NO elegir propietario omite ownerId del payload, lo asigna el backend", async () => {
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

    await user.type(screen.getByLabelText("Nombre"), "Sin");
    await user.type(screen.getByLabelText("Apellido"), "Duenio");
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue(""));
    // createContact llama al MISMO resolveOwnerId que createCompany, asi que
    // el texto por defecto de UserSelect es literal tambien aca. Verificado en
    // ownership.service.ts, no asumido por analogia: Activity comparte el
    // componente pero NO el comportamiento, y por eso pasa un label propio.
    expect(screen.getByLabelText("Propietario")).toHaveTextContent(
      "Asignado a quien crea (por defecto)",
    );
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(postedBody).toEqual({
      firstName: "Sin",
      lastName: "Duenio",
      lifecycleStage: "LEAD",
    });
  });

  it("edit: hidrata el propietario existente en el selector", async () => {
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: "u2" })),
      ),
    );

    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u2"));
  });

  it("edit: un contacto SIN propietario deja el selector vacio, no en un valor inventado", async () => {
    // Contact.ownerId es nullable, a diferencia de Opportunity.ownerId, y por
    // eso la hidratacion hace ?? undefined. Sin eso, un null llegaria al
    // select como value={null} y React lo pasaria a no controlado, con la
    // primera opcion de la lista seleccionada de hecho: el formulario
    // mostraria un dueno que el contacto no tiene.
    server.use(
      usersHandler(),
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeContact({ id: params.id as string, ownerId: null })),
      ),
    );

    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Juana"));
    // waitFor también sobre Propietario, y no es cosmético: desde que los valores
    // se derivan en render (lib/useFormDraft.ts) en vez de sembrarse con un
    // efecto, "Nombre" ya tiene su valor un ciclo ANTES — el efecto forzaba un
    // render extra que este assert aprovechaba sin decirlo para que la query de
    // usuarios llegara a resolver. UserSelect no renderiza el <select> hasta
    // isSuccess, así que hay que esperarlo explícitamente.
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue(""));
  });
});
