import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { BranchFormPage } from "./BranchFormPage";

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

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición.
function renderForm(ruta: string) {
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
  it("Zona horaria arranca en America/Montevideo y ofrece la lista acotada de la región", () => {
    renderForm("/branches/new");

    const zona = screen.getByLabelText("Zona horaria");
    expect(zona).toHaveValue("America/Montevideo");
    // La lista es una restricción del cliente (timezones.ts); el select no
    // ofrece texto libre.
    expect(screen.getByRole("option", { name: /Buenos Aires/ })).toHaveValue(
      "America/Argentina/Buenos_Aires",
    );
    expect(screen.queryByRole("textbox", { name: "Zona horaria" })).not.toBeInTheDocument();
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
    expect(body).toEqual({ name: "Casa Central", timezone: "America/Montevideo" });
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

    await user.type(screen.getByLabelText("Nombre"), "Sucursal Buenos Aires");
    await user.selectOptions(
      screen.getByLabelText("Zona horaria"),
      "America/Argentina/Buenos_Aires",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: "Sucursal Buenos Aires",
      timezone: "America/Argentina/Buenos_Aires",
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
    expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Santiago");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Casa Matriz");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).toBeDefined());
    // Los dos campos siempre, sin diferenciar cuál cambió (ver el comentario
    // de BranchFormPage).
    expect(body).toEqual({ name: "Casa Matriz", timezone: "America/Santiago" });
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
    expect(screen.getByRole("option", { name: "UTC" })).toBeInTheDocument();
    // La lista de la región sigue disponible para corregirla.
    expect(screen.getByRole("option", { name: /Montevideo/ })).toBeInTheDocument();

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

    renderForm("/branches/b1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Montevideo"),
    );
    // Cinco de timezones.ts, ni una más: la extra solo aparece con un valor
    // desconocido.
    expect(screen.getAllByRole("option")).toHaveLength(5);
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
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// BranchFormPage), mismo criterio que auth/AdminRoute.test.tsx.
function renderUnderAdminRoute(initialPath: string) {
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
