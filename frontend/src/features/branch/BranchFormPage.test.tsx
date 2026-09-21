import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse, type HttpHandler } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeUser } from "../../test/userFixtures";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { BranchFormPage } from "./BranchFormPage";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";

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

const baseUrl = `${env.apiUrl}/api/branches`;
const usersUrl = `${env.apiUrl}/api/users`;

// El UserSelect de "Vendedor por defecto" (ítem 69) se monta siempre, así que
// todo test necesita este handler como mínimo — mismo criterio que
// ActivityFormPage.test.tsx.
function usuariosHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [
        makeUser({ id: "u1", fullName: "Ana Pérez", email: "ana@example.com" }),
        makeUser({ id: "u2", fullName: "Beto Gómez", email: "beto@example.com" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

// La sección de Google Calendar (ítem 75) se monta en toda edición y consulta
// GET /branches/:id/google-calendar. El default es "nunca se conectó" (el 404
// real del backend); los tests de esa sección pasan el suyo a renderForm.
function googleCalendarSinConectar() {
  return http.get(`${baseUrl}/:id/google-calendar`, () =>
    HttpResponse.json(
      { error: { message: "Esta sucursal no tiene Google Calendar conectado" } },
      { status: 404 },
    ),
  );
}

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición. Los
// `handlers` extra van PRIMERO: en un mismo server.use, el primero gana, así
// pisan los defaults de acá.
function renderForm(ruta: string, ...handlers: HttpHandler[]) {
  server.use(...handlers, usuariosHandler(), googleCalendarSinConectar());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/branches/new" element={<BranchFormPage />} />
          <Route path="/branches/:id/edit" element={<BranchFormPage />} />
          <Route path="/branches" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BranchFormPage — creación", () => {
  it("Zona horaria arranca en America/Montevideo y ofrece la lista acotada de la región", async () => {
    const user = userEvent.setup();
    renderForm("/branches/new");

    // Desde §46 el control es el combobox del design system: lo que muestra es
    // el RÓTULO de la zona elegida, no su identificador IANA, y sus filas solo
    // están en el DOM con el panel abierto (de ahí listSelectOptions).
    const zona = screen.getByLabelText("Zona horaria");
    expect(zona).toHaveValue("Montevideo (America/Montevideo)");
    // La lista es una restricción del cliente (timezones.ts); el control no
    // ofrece texto libre. Tres opciones, una por comportamiento real de
    // horarios (§26): Buenos Aires y São Paulo son UTC-3 fijo igual que
    // Montevideo, así que ya no se ofrecen como opciones "distintas".
    expect(await listSelectOptions(user, zona)).toEqual([
      "Montevideo (America/Montevideo)",
      "Santiago (America/Santiago)",
      "Asunción (America/Asuncion)",
    ]);
    expect(screen.queryByRole("option", { name: /Buenos Aires/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Paulo/ })).not.toBeInTheDocument();
  });

  it("crea la sucursal con name + timezone (Montevideo por defecto) y vuelve al listado", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    // La clave viaja siempre, en null cuando no se eligió a nadie (ítem 69).
    expect(body).toEqual({
      name: "Casa Central",
      timezone: "America/Montevideo",
      defaultOwnerId: null,
      paymentLinkUrl: null,
      bankTransferDetails: null,
    });
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
  });

  it("la zona elegida en el select viaja en el POST", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Sucursal Santiago");
    await chooseSelectOption(
      user,
      screen.getByLabelText("Zona horaria"),
      "Santiago (America/Santiago)",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Sucursal Santiago",
      timezone: "America/Santiago",
      defaultOwnerId: null,
      paymentLinkUrl: null,
      bankTransferDetails: null,
    });
  });

  it("un error del backend se muestra sin perder lo cargado", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "timezone debe ser una zona horaria IANA válida (ej. America/Argentina/Buenos_Aires)",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "X");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/zona horaria IANA válida/);
    expect(screen.getByLabelText("Nombre")).toHaveValue("X");
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});

describe("BranchFormPage — edición", () => {
  it("hidrata Nombre y Zona horaria desde GET /api/branches/:id y el PATCH manda los dos campos", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeBranch({ id: "b1", name: "Casa Central", timezone: "America/Santiago" }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Casa Central"));
    expect(screen.getByLabelText("Zona horaria")).toHaveValue("Santiago (America/Santiago)");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Casa Matriz");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    // Los dos campos siempre, sin diferenciar cuál cambió (ver el comentario
    // de BranchFormPage).
    expect(body).toEqual({
      name: "Casa Matriz",
      timezone: "America/Santiago",
      defaultOwnerId: null,
      paymentLinkUrl: null,
      bankTransferDetails: null,
    });
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
  });

  it("una zona persistida FUERA de la lista aparece como opción extra y se conserva al guardar", async () => {
    // Sucursal creada por API con "UTC": el select tiene que mostrarla, no
    // caer en silencio a Montevideo mientras el PATCH manda otra cosa.
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeBranch({ id: "b1", timezone: "UTC" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1", timezone: "UTC" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() => expect(screen.getByLabelText("Zona horaria")).toHaveValue("UTC"));
    // Una zona fuera de la lista no tiene rótulo propio: se ofrece con su
    // identificador tal cual, primera y antes de las tres de la región, que
    // siguen disponibles para corregirla.
    expect(await listSelectOptions(user, screen.getByLabelText("Zona horaria"))).toEqual([
      "UTC",
      "Montevideo (America/Montevideo)",
      "Santiago (America/Santiago)",
      "Asunción (America/Asuncion)",
    ]);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect((body as { timezone: string }).timezone).toBe("UTC");
  });

  it("con una zona de la lista NO se agrega ninguna opción extra", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeBranch({ id: "b1", timezone: "America/Montevideo" })),
      ),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Zona horaria")).toHaveValue("Montevideo (America/Montevideo)"),
    );
    // Tres de timezones.ts, ni una más: la extra solo aparece con un valor
    // desconocido.
    expect(await listSelectOptions(user, screen.getByLabelText("Zona horaria"))).toHaveLength(3);
  });

  it("una sucursal guardada con una zona que SALIÓ de la lista (Buenos Aires, §26) sigue editable: opción extra, valor intacto al guardar, y elegir otra zona la reemplaza", async () => {
    // No se migra ningún dato: una sucursal creada antes del §26 (o por API)
    // con America/Argentina/Buenos_Aires sigue siendo válida. Es el mismo
    // mecanismo que el caso de "UTC" de arriba, pero con una zona que ANTES
    // sí estaba en la lista, para dejar cubierto que sacarla no la rompe.
    const bodies: unknown[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeBranch({ id: "b1", timezone: "America/Argentina/Buenos_Aires" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    const user = userEvent.setup();
    const { unmount } = renderForm("/branches/b1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Argentina/Buenos_Aires"),
    );
    // La extra es la vigente, más las tres de la lista: cuatro en total.
    expect(await listSelectOptions(user, screen.getByLabelText("Zona horaria"))).toEqual([
      "America/Argentina/Buenos_Aires",
      "Montevideo (America/Montevideo)",
      "Santiago (America/Santiago)",
      "Asunción (America/Asuncion)",
    ]);

    // Guardar sin tocar la zona: el PATCH manda la vieja tal cual, no
    // Montevideo.
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { timezone: string }).timezone).toBe("America/Argentina/Buenos_Aires");
    unmount();

    // Elegir una de la lista: la extra desaparece (ya no es la vigente) y el
    // PATCH manda la nueva.
    renderForm("/branches/b1/edit");
    await waitFor(() =>
      expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Argentina/Buenos_Aires"),
    );
    await chooseSelectOption(
      user,
      screen.getByLabelText("Zona horaria"),
      "Montevideo (America/Montevideo)",
    );
    expect(await listSelectOptions(user, screen.getByLabelText("Zona horaria"))).toEqual([
      "Montevideo (America/Montevideo)",
      "Santiago (America/Santiago)",
      "Asunción (America/Asuncion)",
    ]);

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect((bodies[1] as { timezone: string }).timezone).toBe("America/Montevideo");
  });

  it("estado de carga y estado de error al traer la sucursal", async () => {
    server.use(http.get(`${baseUrl}/:id`, () => new Promise(() => undefined)));
    const { unmount } = renderForm("/branches/b1/edit");
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    unmount();

    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Sucursal no encontrada" } }, { status: 404 }),
      ),
    );
    renderForm("/branches/b1/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sucursal no encontrada");
  });
});

// Ítem 10 de docs/frontend-cambios-pendientes.md: la marca visual tiene que
// coincidir con el `required` real de cada control.
describe("BranchFormPage — campos obligatorios", () => {
  it("Nombre y Zona horaria llevan la marca, y la referencia del asterisco va una sola vez", () => {
    renderForm("/branches/new");

    expect(screen.getByLabelText("Nombre")).toBeRequired();
    expect(screen.getByText("Nombre")).toHaveClass("ds-required");
    expect(screen.getByLabelText("Zona horaria")).toBeRequired();
    expect(screen.getByText("Zona horaria")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);
  });

  it("Vendedor por defecto NO lleva la marca: una sucursal sin ninguno es un estado válido", async () => {
    renderForm("/branches/new");

    const campo = await screen.findByLabelText("Vendedor por defecto");
    expect(campo).not.toBeRequired();
    expect(screen.getByText("Vendedor por defecto")).not.toHaveClass("ds-required");
  });
});

// ---------------------------------------------------------------------------
// Ítem 69 — el vendedor por defecto de la sucursal
// ---------------------------------------------------------------------------
describe("BranchFormPage — vendedor por defecto", () => {
  it("el campo aparece con su hint y se puede guardar la sucursal sin elegir a nadie", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    expect(await screen.findByLabelText("Vendedor por defecto")).toBeInTheDocument();
    expect(
      screen.getByText(/Se usa cuando el agente de IA necesita asignar un vendedor/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Sin `required`: si se hubiera colado, el <form> nativo habría frenado el
    // submit y no habría habido POST.
    await waitFor(() => expect(body).toBeDefined());
    expect((body as { defaultOwnerId: string | null }).defaultOwnerId).toBeNull();
  });

  it("elegir un vendedor lo hace viajar en el POST", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await chooseSelectOption(
      user,
      await screen.findByLabelText("Vendedor por defecto"),
      "Beto Gómez",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Casa Central",
      timezone: "America/Montevideo",
      defaultOwnerId: "u2",
      paymentLinkUrl: null,
      bankTransferDetails: null,
    });
  });

  it("en edición hidrata el vendedor guardado y lo conserva en el PATCH", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeBranch({ id: "b1", defaultOwnerId: "u2" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1", defaultOwnerId: "u2" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Vendedor por defecto")).toHaveValue("Beto Gómez"),
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect((body as { defaultOwnerId: string | null }).defaultOwnerId).toBe("u2");
  });

  it("volver a dejarlo en blanco en una edición manda null, que es como se desvincula", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeBranch({ id: "b1", defaultOwnerId: "u2" })),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Vendedor por defecto")).toHaveValue("Beto Gómez"),
    );

    // La fila vacía se ofrece SIEMPRE (clearable por defecto), incluso con un
    // vendedor ya elegido: es la única forma de sacarlo.
    await chooseSelectOption(
      user,
      screen.getByLabelText("Vendedor por defecto"),
      "Sin vendedor por defecto",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect((body as { defaultOwnerId: string | null }).defaultOwnerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ítem 74 — datos de cobro (link de pago / transferencia)
// ---------------------------------------------------------------------------
describe("BranchFormPage — cobro", () => {
  const LINK = "https://mpago.la/2abc3de";
  const TRANSFERENCIA = "Banco República\nCuenta 001234567-00001";

  it("los dos campos aparecen vacíos, sin asterisco, y guardar sin tocarlos manda las dos claves en null", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    const link = screen.getByLabelText("Link de pago");
    const transferencia = screen.getByLabelText("Datos para transferencia");
    expect(link).toHaveValue("");
    expect(transferencia).toHaveValue("");
    expect(link).not.toBeRequired();
    expect(transferencia).not.toBeRequired();
    expect(screen.getByText("Link de pago")).not.toHaveClass("ds-required");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ paymentLinkUrl: null, bankTransferDetails: null });
  });

  it("cargar los dos los hace viajar en el POST, recortados", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.type(screen.getByLabelText("Link de pago"), `  ${LINK}  `);
    await user.type(screen.getByLabelText("Datos para transferencia"), "  Alias: casa.central  ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Casa Central",
      timezone: "America/Montevideo",
      defaultOwnerId: null,
      paymentLinkUrl: LINK,
      bankTransferDetails: "Alias: casa.central",
    });
  });

  it("son independientes: solo los datos de transferencia manda el link en null", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.type(screen.getByLabelText("Datos para transferencia"), "Alias: casa.central");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      paymentLinkUrl: null,
      bankTransferDetails: "Alias: casa.central",
    });
  });

  it("en edición hidrata los dos y los conserva en el PATCH", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeBranch({ id: "b1", paymentLinkUrl: LINK, bankTransferDetails: TRANSFERENCIA }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() => expect(screen.getByLabelText("Link de pago")).toHaveValue(LINK));
    expect(screen.getByLabelText("Datos para transferencia")).toHaveValue(TRANSFERENCIA);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    // Los saltos de línea del texto libre viajan tal cual.
    expect(body).toMatchObject({ paymentLinkUrl: LINK, bankTransferDetails: TRANSFERENCIA });
  });

  it("vaciar los dos en una edición manda null — es como se sacan de la sucursal", async () => {
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeBranch({ id: "b1", paymentLinkUrl: LINK, bankTransferDetails: TRANSFERENCIA }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/branches/b1/edit");

    await waitFor(() => expect(screen.getByLabelText("Link de pago")).toHaveValue(LINK));
    await user.clear(screen.getByLabelText("Link de pago"));
    // Solo espacios cuenta como vacío.
    await user.clear(screen.getByLabelText("Datos para transferencia"));
    await user.type(screen.getByLabelText("Datos para transferencia"), "   ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ paymentLinkUrl: null, bankTransferDetails: null });
  });

  it("un link rechazado por el backend se muestra sin perder lo cargado", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "paymentLinkUrl tiene que empezar con http:// o https://" } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/branches/new");

    await user.type(screen.getByLabelText("Nombre"), "Casa Central");
    await user.type(screen.getByLabelText("Link de pago"), "https://ok.example");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/paymentLinkUrl/);
    expect(screen.getByLabelText("Link de pago")).toHaveValue("https://ok.example");
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// BranchFormPage), mismo criterio que auth/AdminRoute.test.tsx.
function renderUnderAdminRoute(initialPath: string) {
  server.use(usuariosHandler(), googleCalendarSinConectar());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/branches/new" element={<BranchFormPage />} />
              <Route path="/branches/:id/edit" element={<BranchFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BranchFormPage — bajo AdminRoute", () => {
  it("un USER entrando a /branches/new es redirigido sin ver el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderUnderAdminRoute("/branches/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("un USER entrando a /branches/:id/edit es redirigido y NO se pide GET /api/branches/:id", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let llamadas = 0;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        llamadas += 1;
        return HttpResponse.json(makeBranch({ id: "b1" }));
      }),
    );

    renderUnderAdminRoute("/branches/b1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(llamadas).toBe(0);
  });

  it("un ADMIN sí ve el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderUnderAdminRoute("/branches/new");

    expect(await screen.findByRole("heading", { name: "Nueva sucursal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ítem 75 — la sección "Google Calendar": sus tres estados (sin conectar,
// conectando, conectada), la vuelta del callback y el caso ERROR.
// ---------------------------------------------------------------------------

function sucursalB1() {
  return http.get(`${baseUrl}/:id`, () =>
    HttpResponse.json(makeBranch({ id: "b1", name: "Casa Central" })),
  );
}

function conexion(overrides: Record<string, unknown> = {}) {
  return {
    id: "gc1",
    organizationId: "org-1",
    branchId: "b1",
    calendarId: "primary",
    status: "ACTIVE",
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("BranchFormPage — Google Calendar", () => {
  it("no aparece en el alta: la conexión cuelga del id de la sucursal", () => {
    renderForm("/branches/new");
    expect(screen.queryByRole("heading", { name: "Google Calendar" })).not.toBeInTheDocument();
  });

  it("sin conectar (404): Conectar abre la URL de Google en una pestaña NUEVA y pasa a conectando", async () => {
    let posts = 0;
    let consultas = 0;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderForm(
      "/branches/b1/edit",
      sucursalB1(),
      http.get(`${baseUrl}/:id/google-calendar`, () => {
        consultas += 1;
        // La segunda consulta —"Volver a consultar", después de autorizar en
        // la otra pestaña— ya encuentra la conexión.
        return consultas === 1
          ? HttpResponse.json(
              { error: { message: "Esta sucursal no tiene Google Calendar conectado" } },
              { status: 404 },
            )
          : HttpResponse.json(conexion());
      }),
      http.post(`${baseUrl}/:id/google-calendar/connect`, () => {
        posts += 1;
        return HttpResponse.json({
          authorizationUrl: "https://accounts.google.com/o/oauth2/auth?x=1",
        });
      }),
    );

    expect(await screen.findByText("Sin conectar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Conectar con Google Calendar" }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/auth?x=1",
        "_blank",
        "noopener",
      ),
    );
    expect(posts).toBe(1);
    // Conectando: se dice qué hacer, con el link por si se bloqueó la pestaña.
    expect(screen.getByText(/Terminá la autorización en la pestaña de Google/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Si no se abrió, abrila acá." })).toHaveAttribute(
      "href",
      "https://accounts.google.com/o/oauth2/auth?x=1",
    );
    // La pestaña actual NO navegó: el formulario sigue ahí.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Casa Central");

    await user.click(screen.getByRole("button", { name: "Volver a consultar" }));
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("primary")).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("conectada: muestra el calendario y Desconectar pregunta antes y manda el DELETE", async () => {
    let deletes = 0;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const user = userEvent.setup();
    renderForm(
      "/branches/b1/edit",
      sucursalB1(),
      http.get(`${baseUrl}/:id/google-calendar`, () =>
        HttpResponse.json(
          deletes === 0
            ? conexion({ calendarId: "agenda@negocio.com" })
            : conexion({ status: "REVOKED" }),
        ),
      ),
      http.delete(`${baseUrl}/:id/google-calendar`, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    expect(await screen.findByText("agenda@negocio.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(deletes).toBe(0);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(deletes).toBe(1));
    // Se vuelve a consultar el estado, y una conexión REVOKED se lee como sin conectar.
    expect(
      await screen.findByRole("button", { name: "Conectar con Google Calendar" }),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("una conexión en ERROR dice por qué y ofrece reconectar", async () => {
    renderForm(
      "/branches/b1/edit",
      sucursalB1(),
      http.get(`${baseUrl}/:id/google-calendar`, () =>
        HttpResponse.json(
          conexion({ status: "ERROR", lastErrorMessage: "invalid_grant: Token has been revoked" }),
        ),
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La conexión dejó de funcionar: invalid_grant: Token has been revoked",
    );
    expect(
      screen.getByRole("button", { name: "Conectar con Google Calendar" }),
    ).toBeInTheDocument();
  });

  it("si iniciar la conexión falla, se muestra el error y no se abre ninguna pestaña", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderForm(
      "/branches/b1/edit",
      sucursalB1(),
      http.post(`${baseUrl}/:id/google-calendar/connect`, () =>
        HttpResponse.json(
          { error: { message: "Google Calendar no está configurado en el servidor" } },
          { status: 500 },
        ),
      ),
    );

    await user.click(await screen.findByRole("button", { name: "Conectar con Google Calendar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos iniciar la conexión: Google Calendar no está configurado en el servidor",
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("la vuelta del callback con calendarConnected=true avisa que quedó conectado", async () => {
    renderForm(
      "/branches/b1/edit?calendarConnected=true",
      sucursalB1(),
      http.get(`${baseUrl}/:id/google-calendar`, () => HttpResponse.json(conexion())),
    );

    expect(await screen.findByText("Google Calendar quedó conectado.")).toBeInTheDocument();
  });

  it("la vuelta del callback con calendarError muestra el mensaje del backend", async () => {
    renderForm(
      "/branches/b1/edit?calendarError=" +
        encodeURIComponent("Se canceló la autorización en Google. La sucursal quedó sin conectar."),
      sucursalB1(),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar Google Calendar: Se canceló la autorización en Google. La sucursal quedó sin conectar.",
    );
  });
});
