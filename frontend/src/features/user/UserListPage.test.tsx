import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { UserListPage } from "./UserListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { UserListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(meId = "self1"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: meId, email: "a@x.com", fullName: "A", organizationId: "org-1", role: "ADMIN" },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const usersUrl = `${env.apiUrl}/api/users`;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UserListPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("UserListPage", () => {
  it("loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth());
    const listResponse: UserListResponse = {
      data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(http.get(usersUrl, () => HttpResponse.json(listResponse)));

    renderPage();

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
  });

  it("error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth());
    server.use(
      http.get(usersUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(/No pudimos cargar los usuarios/)).toBeInTheDocument());
  });

  it("empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth());
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("No hay usuarios para mostrar.")).toBeInTheDocument());
  });

  it("filtros reales (role/isActive) producen la query esperada, y paginación avanza", async () => {
    useAuthMock.mockReturnValue(mockAuth());
    const captured: URL[] = [];
    server.use(
      http.get(usersUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeUser({ fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Rol"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Estado"), "true");
    await user.click(screen.getByText("Siguiente"));

    await waitFor(() =>
      expect(captured.some((u) => u.searchParams.get("page") === "2")).toBe(true),
    );
    const withFilters = captured.find(
      (u) => u.searchParams.get("role") === "ADMIN" && u.searchParams.get("isActive") === "true",
    );
    expect(withFilters).toBeDefined();
  });

  it("cambiar el rol de otro usuario hace PATCH con el payload correcto", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.get(usersUrl, () =>
        // role default de makeUser() es ADMIN — se parte de ADMIN para
        // poder seleccionar USER y ejercitar un cambio real (el <select>
        // no dispara la mutation si el valor elegido es el mismo que ya
        // tiene la fila, ver UserListPage.tsx).
        HttpResponse.json({
          data: [makeUser({ id: "u2", fullName: "Beto Gómez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.patch(`${usersUrl}/u2`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeUser({ id: "u2", fullName: "Beto Gómez" }));
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Beto Gómez")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Rol de Beto Gómez"), "USER");

    await waitFor(() => expect(patchedBody).toEqual({ role: "USER" }));
  });

  it("desactivar/activar hace PATCH con isActive", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u2", fullName: "Beto Gómez", isActive: true })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.patch(`${usersUrl}/u2`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeUser({ id: "u2" }));
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Beto Gómez")).toBeInTheDocument());
    await user.click(screen.getByText("Desactivar"));

    await waitFor(() => expect(patchedBody).toEqual({ isActive: false }));
  });

  it("eliminar: confirma, ejecuta la mutation y muestra error real si falla", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u2", fullName: "Beto Gómez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${usersUrl}/u2`, () =>
        HttpResponse.json({ error: { message: "No se puede eliminar al último ADMIN activo de la organización" } }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Beto Gómez")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText("No se puede eliminar al último ADMIN activo de la organización"),
      ).toBeInTheDocument(),
    );
    confirmSpy.mockRestore();
  });

  it("eliminar: cancelar el confirm no dispara ningún request", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    let deleteRequested = false;
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u2", fullName: "Beto Gómez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${usersUrl}/u2`, () => {
        deleteRequested = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Beto Gómez")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteRequested).toBe(false);
    confirmSpy.mockRestore();
  });

  it("la fila del usuario autenticado no muestra controles de modificación, solo su rol como texto", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "self1", fullName: "Yo Mismo" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText("Yo Mismo")).toBeInTheDocument());
    const row = screen.getByText("Yo Mismo").closest("tr") as HTMLElement;

    expect(screen.queryByLabelText("Rol de Yo Mismo")).not.toBeInTheDocument();
    expect(within(row).queryByText("Desactivar")).not.toBeInTheDocument();
    expect(within(row).queryByText("Activar")).not.toBeInTheDocument();
    expect(within(row).queryByText("Eliminar")).not.toBeInTheDocument();
    expect(within(row).getByText("ADMIN")).toBeInTheDocument();
  });

  it("nunca muestra el UUID crudo del usuario en ninguna celda", async () => {
    useAuthMock.mockReturnValue(mockAuth("self1"));
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "11111111-2222-3333-4444-555555555555", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    expect(screen.queryByText("11111111-2222-3333-4444-555555555555")).not.toBeInTheDocument();
  });
});
