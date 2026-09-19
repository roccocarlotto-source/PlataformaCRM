import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeKnowledgeBaseEntry } from "../../test/knowledgeBaseFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { KnowledgeBaseFormPage } from "./KnowledgeBaseFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usa el bloque de AdminRoute del final: el formulario no consume
// useAuth.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/api/knowledge-base`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function mockBranches() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición.
function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/knowledge-base/new" element={<KnowledgeBaseFormPage />} />
          <Route path="/knowledge-base/:id/edit" element={<KnowledgeBaseFormPage />} />
          <Route path="/knowledge-base" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// El contenido se PEGA en vez de tipearse: es lo que una persona hace de
// verdad con un párrafo, y el test no depende de cientos de eventos de teclado.
async function escribirContenido(user: ReturnType<typeof userEvent.setup>, texto: string) {
  const campo = screen.getByLabelText("Contenido");
  await user.clear(campo);
  await user.click(campo);
  await user.paste(texto);
}

describe("KnowledgeBaseFormPage — creación", () => {
  it("manda el POST con los cuatro campos y vuelve al listado", async () => {
    const bodies: unknown[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Horarios de atención");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "Lunes a viernes de 9 a 18.");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        branchId: "b2",
        title: "Horarios de atención",
        content: "Lunes a viernes de 9 a 18.",
        // Activa por default: una entrada nueva entra al prompt sin que haya
        // que configurar nada.
        isActive: true,
      },
    ]);
  });

  it("no hay traducción ni confirmación: el POST sale directo, sin ningún paso intermedio", async () => {
    let llamadas = 0;
    server.use(
      mockBranches(),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Formas de pago");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "Efectivo, débito y crédito hasta 6 cuotas.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // A diferencia de las reglas del agente (ítem 56), esto es texto plano que
    // se usa tal cual: no hay panel de "esto es lo que entendimos".
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(llamadas).toBe(1));
  });

  it("guardar como inactiva: se manda isActive false", async () => {
    const bodies: { isActive?: boolean }[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { isActive?: boolean });
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Promo de invierno");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "20% en todos los servicios.");
    await user.click(screen.getByLabelText("Activa"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies[0]?.isActive).toBe(false));
  });

  it("con la lista de sucursales todavía cargando no sale ninguna request y se explica por qué", async () => {
    // El hueco que BranchSelect documenta y que cada formulario cubre por su
    // cuenta: mientras la lista carga NO hay ningún input que el `required`
    // del navegador pueda frenar, así que el submit llega y lo tiene que
    // detener validar(). Con la lista ya cargada este camino no se alcanza —
    // el propio <form> bloquea antes.
    let llamadas = 0;
    server.use(
      http.get(branchesUrl, () => new Promise(() => undefined)),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeKnowledgeBaseEntry(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Horarios");
    await escribirContenido(user, "Lunes a viernes de 9 a 18.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elegí la sucursal a la que pertenece esta entrada.",
    );
    expect(llamadas).toBe(0);
  });

  it("Título y Contenido son requeridos por el navegador, y llevan el tope del backend", async () => {
    server.use(mockBranches());
    renderForm("/knowledge-base/new");

    const titulo = screen.getByLabelText("Título");
    expect(titulo).toBeRequired();
    expect(titulo).toHaveAttribute("maxLength", "200");

    const contenido = screen.getByLabelText("Contenido");
    expect(contenido).toBeRequired();
    expect(contenido).toHaveAttribute("maxLength", "10000");
  });

  it("un POST fallido muestra el mensaje del backend y NO navega", async () => {
    server.use(
      mockBranches(),
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "content no puede superar los 10000 caracteres" } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/new");

    await user.type(screen.getByLabelText("Título"), "Muy larga");
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await escribirContenido(user, "x".repeat(50));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "content no puede superar los 10000 caracteres",
    );
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});

describe("KnowledgeBaseFormPage — edición", () => {
  it("hidrata los cuatro campos con lo que devuelve el GET", async () => {
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeKnowledgeBaseEntry({
            title: "Política de cancelación",
            content: "Se puede cancelar hasta 24 horas antes.",
            branchId: "b2",
            isActive: false,
          }),
        ),
      ),
    );

    renderForm("/knowledge-base/kb1/edit");

    expect(await screen.findByLabelText("Título")).toHaveValue("Política de cancelación");
    expect(screen.getByLabelText("Contenido")).toHaveValue(
      "Se puede cancelar hasta 24 horas antes.",
    );
    expect(screen.getByLabelText("Activa")).not.toBeChecked();
    await waitFor(() => expect(screen.getByLabelText("Sucursal")).toHaveValue("Sucursal Chuy"));
  });

  it("la sucursal SÍ se puede cambiar, a diferencia del formulario de Agente", async () => {
    const bodies: { branchId?: string }[] = [];
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeKnowledgeBaseEntry({ branchId: "b1" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as { branchId?: string });
        return HttpResponse.json(makeKnowledgeBaseEntry({ branchId: "b2" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/kb1/edit");

    // Habilitado, no deshabilitado con una explicación: no hay ningún dato
    // histórico que dependa de la sucursal de una entrada de KB.
    const sucursal = await screen.findByLabelText("Sucursal");
    expect(sucursal).toBeEnabled();
    await chooseSelectOption(user, sucursal, "Sucursal Chuy");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies[0]?.branchId).toBe("b2");
  });

  it("el PATCH manda los cuatro campos, no un diff", async () => {
    const bodies: unknown[] = [];
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeKnowledgeBaseEntry())),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeKnowledgeBaseEntry());
      }),
    );

    const user = userEvent.setup();
    renderForm("/knowledge-base/kb1/edit");

    const titulo = await screen.findByLabelText("Título");
    await user.clear(titulo);
    await user.type(titulo, "Horarios");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    // "La entrada queda así" es más simple que un diff, y el PATCH parcial lo
    // acepta — mismo criterio que Agent, Branch y Source.
    expect(bodies).toEqual([
      {
        branchId: "b1",
        title: "Horarios",
        content: "Lunes a viernes de 9 a 18. Sábados de 9 a 13.",
        isActive: true,
      },
    ]);
  });

  it("un GET fallido muestra el error y no renderiza el formulario", async () => {
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "Entrada de la base de conocimiento no encontrada" } },
          { status: 404 },
        ),
      ),
    );

    renderForm("/knowledge-base/kb1/edit");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Entrada de la base de conocimiento no encontrada",
    );
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx — el formulario es ADMIN-only por
// ruta, igual que el listado.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/knowledge-base/new" element={<KnowledgeBaseFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeBaseFormPage — bajo AdminRoute", () => {
  it("un USER entrando a /knowledge-base/new es redirigido", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(mockBranches());

    renderUnderAdminRoute("/knowledge-base/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Nueva entrada" })).not.toBeInTheDocument();
  });

  it("un ADMIN sí ve el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(mockBranches());

    renderUnderAdminRoute("/knowledge-base/new");

    expect(await screen.findByRole("heading", { name: "Nueva entrada" })).toBeInTheDocument();
  });
});
