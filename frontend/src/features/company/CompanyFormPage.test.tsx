import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeCompany } from "../../test/companyFixtures";
import { makeUser } from "../../test/userFixtures";
import { CompanyFormPage } from "./CompanyFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// El formulario preselecciona a quien crea a partir de useAuth().me (ítem 7
// de docs/frontend-cambios-pendientes.md). Se mockea por ruta de módulo, como
// en CompanyListPage.test.tsx: "u1" es Ana Pérez en usersHandler(), así que
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

const baseUrl = `${env.apiUrl}/api/companies`;
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
          <Route path="/companies/new" element={<CompanyFormPage />} />
          <Route path="/companies/:id/edit" element={<CompanyFormPage />} />
          <Route path="/companies" element={<div>lista de empresas</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompanyFormPage", () => {
  it("D.15 create mode: no pide detail, submit usa create, navega tras el éxito", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makeCompany());
      }),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany({ name: "Acme Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    expect(getDetailCalled).toBe(false);

    await user.type(screen.getByLabelText("Nombre"), "Acme Nueva");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    // ownerId viaja siempre en creación: es el usuario actual, preseleccionado
    // (ver el bloque ownerId más abajo).
    expect(postedBody).toEqual({ name: "Acme Nueva", ownerId: "u1" });
  });

  it("D.16 edit mode: carga detail, hidrata el form, submit usa update sobre el id correcto, navega tras el éxito", async () => {
    // No usar expect() dentro del resolver de MSW: si falla, se propaga como
    // una excepción no manejada dentro de la resolución del fetch (visible
    // en la UI como "Unhandled Exception"), no como un fallo de test legible.
    // Se captura lo necesario y se asegura después, en el cuerpo del test.
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeCompany({ id: params.id as string, name: "Acme Original", industry: "tech" }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makeCompany({ id: "c1", name: "Acme Editada" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Acme Original"));
    expect(screen.getByLabelText("Industria")).toHaveValue("tech");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Acme Editada");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(patchedId).toBe("c1");
    // El formulario envía el estado completo vigente, no un diff — industry
    // sigue en "tech" (nunca se tocó), así que viaja igual que name. Este es
    // el comportamiento real de toInput(), no algo que este test invente.
    expect(patchedBody).toEqual({ name: "Acme Editada", industry: "tech" });
  });

  it("D.17 error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("D.18 error de create no navega y muestra el error", async () => {
    server.use(
      usersHandler(),
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "no se pudo crear" } }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo crear"));
    expect(screen.queryByText("lista de empresas")).not.toBeInTheDocument();
  });

  it("D.19 campos opcionales vacíos se envían como undefined, no como cadena vacía", async () => {
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany({ name: "Acme" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    // Si domain/industria/etc. viajaran como "" en vez de ausentes, este
    // toEqual fallaría — protege la semántica que toInput() ya implementaba
    // de un cambio incidental. ownerId no es un opcional vacío: es el
    // usuario actual, preseleccionado en creación.
    expect(postedBody).toEqual({ name: "Acme", ownerId: "u1" });
  });

  // -------------------------------------------------------------------------
  // ownerId — el gap de M2 cerrado (ver el comentario de CompanyFormPage.tsx).
  // -------------------------------------------------------------------------

  it("create: elegir un propietario lo manda en el POST", async () => {
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany({ name: "Acme Owner" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme Owner");
    // El select recien existe cuando la query de usuarios resolvio: UserSelect
    // no renderiza nada hasta isSuccess.
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Propietario"), "u2");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(postedBody).toEqual({ name: "Acme Owner", ownerId: "u2" });
  });

  it("create: el propietario arranca preseleccionado en quien crea, sin opción 'por defecto', y viaja en el POST", async () => {
    let postedBody: unknown;
    server.use(
      usersHandler(),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme Owner Actual");
    // Ítem 7 de docs/frontend-cambios-pendientes.md: el usuario actual ("u1",
    // Ana Pérez) ya está marcado, y la antigua opción "Asignado a quien crea
    // (por defecto)" —que decía lo mismo que elegirse a uno mismo— no existe
    // más. Tampoco hay opción vacía de ningún tipo mientras haya un valor.
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u1"));
    const select = screen.getByLabelText("Propietario");
    expect(select).not.toHaveTextContent("Asignado a quien crea (por defecto)");
    expect(select).not.toHaveTextContent("Sin asignar");
    expect(select.querySelector('option[value=""]')).toBeNull();
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    // El id viaja explícito. Es lo mismo que resolveOwnerId haría si no se
    // mandara nada (actorUserId), pero ahora es una elección visible.
    expect(postedBody).toEqual({ name: "Acme Owner Actual", ownerId: "u1" });
  });

  it("edit: hidrata el propietario existente en el selector, sin opción vacía", async () => {
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeCompany({ id: params.id as string, ownerId: "u2" })),
      ),
    );

    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u2"));
    // Con un dueño real, "Sin asignar" no se ofrece: el PATCH no podría
    // limpiar ownerId de todos modos (chequeo truthy en company.service.ts).
    expect(screen.getByLabelText("Propietario")).not.toHaveTextContent("Sin asignar");
  });

  it("edit: una empresa SIN propietario muestra 'Sin asignar', no al usuario actual ni un valor inventado", async () => {
    // Company.ownerId es nullable, a diferencia de Opportunity.ownerId, y por
    // eso la hidratacion hace ?? undefined. Sin eso, un null llegaria al
    // select como value={null} y React lo pasaria a no controlado, con la
    // primera opcion de la lista seleccionada de hecho: el formulario
    // mostraria un dueno que la empresa no tiene.
    //
    // Y a diferencia de crear, acá NO se preselecciona a quien edita: el
    // backend solo autoasigna al crear, nunca al editar (el update toca
    // ownerId solo si viene truthy), así que guardar sin tocar el campo deja
    // la empresa sin dueño — "Sin asignar" es literal.
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeCompany({ id: params.id as string, ownerId: null })),
      ),
    );

    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Acme"));
    // waitFor también sobre Propietario, y no es un ajuste cosmético: desde que
    // los valores se derivan en render (lib/useFormDraft.ts) en vez de sembrarse
    // con un efecto, "Nombre" ya tiene su valor un ciclo ANTES — el efecto
    // forzaba un render extra que este assert aprovechaba sin decirlo para que
    // la query de usuarios llegara a resolver. UserSelect no renderiza el
    // <select> hasta isSuccess, así que hay que esperarlo explícitamente.
    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue(""));
    expect(screen.getByRole("option", { name: "Sin asignar" })).toHaveValue("");
    expect(screen.getByLabelText("Propietario")).not.toHaveTextContent(
      "Asignado a quien crea (por defecto)",
    );
  });

  // ---------------------------------------------------------------------------
  // El efecto de hidratación perdía datos, y este test es lo que lo fija.
  // ---------------------------------------------------------------------------

  it("un refetch NO pisa lo que el usuario venía escribiendo", async () => {
    // refetchOnWindowFocus:true + staleTime 30s (lib/queryClient.ts): alcanza
    // con que alguien edite el mismo registro del otro lado mientras vos
    // escribís. Al volver a la pestaña el refetch traía un objeto nuevo y el
    // useEffect de hidratación pisaba todo lo tipeado, sin aviso.
    let llamadas = 0;
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) => {
        llamadas += 1;
        return HttpResponse.json(
          makeCompany({
            id: params.id as string,
            name: llamadas === 1 ? "Acme" : "Acme cambiada por otro",
          }),
        );
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/companies/c1/edit"]}>
          <Routes>
            <Route path="/companies/:id/edit" element={<CompanyFormPage />} />
            <Route path="/companies" element={<div>lista de empresas</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Acme"));

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Lo que el usuario escribio");

    await queryClient.refetchQueries();
    await waitFor(() => expect(llamadas).toBe(2));

    // Con el efecto viejo esto devolvía "Acme cambiada por otro".
    expect(screen.getByLabelText("Nombre")).toHaveValue("Lo que el usuario escribio");
  });

  it("cambiar de registro SIN desmontar vuelve a derivar, no arrastra el borrador", async () => {
    // React Router no remonta al ir de /companies/c1/edit a /companies/c2/edit:
    // es la misma ruta. El borrador va atado al id justamente por esto.
    server.use(
      usersHandler(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeCompany({ id: params.id as string, name: params.id === "c1" ? "Uno" : "Dos" }),
        ),
      ),
    );

    function Cambiador() {
      const [id, setId] = useState("c1");
      return (
        <MemoryRouter initialEntries={[`/companies/${id}/edit`]} key={id}>
          <Routes>
            <Route
              path="/companies/:id/edit"
              element={
                <>
                  <button type="button" onClick={() => setId("c2")}>
                    ir a c2
                  </button>
                  <CompanyFormPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Cambiador />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Uno"));
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Editando Uno");

    await user.click(screen.getByRole("button", { name: "ir a c2" }));

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Dos"));
  });
});
