import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeQrCode } from "../../test/qrFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { ClaimPage } from "./ClaimPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: "u1", email: "a@x.com", fullName: "A", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const claimUrl = `${env.apiUrl}/api/qr/claim`;
const branchesUrl = `${env.apiUrl}/api/branches`;
const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

function branchesHandler() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch({ id: "b1", name: "Casa Central" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function renderPage(path: string, role: "ADMIN" | "USER" = "ADMIN") {
  useAuthMock.mockReturnValue(mockAuth(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/claim/:qrId" element={<ClaimPage />} />
          <Route path="/qr" element={<div>lista de qr</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ClaimPage", () => {
  it("USER: mensaje claro, sin formulario, sin pegarle a sucursales ni a claim (decisión 8)", async () => {
    let fetched = false;
    server.use(
      http.get(branchesUrl, () => {
        fetched = true;
        return HttpResponse.json({ data: [], pagination: {} });
      }),
    );

    renderPage(`/claim/${QR_ID}`, "USER");

    expect(
      screen.getByText(
        "Necesitás iniciar sesión como administrador de tu cuenta para reclamar este QR.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // La query de sucursales ni se dispara: el componente corta antes de montarla.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetched).toBe(false);
  });

  it("ADMIN: valida en el cliente antes de mandar", async () => {
    let posted = false;
    server.use(
      branchesHandler(),
      http.post(claimUrl, () => {
        posted = true;
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/claim/${QR_ID}`);
    await waitFor(() => expect(screen.getByText("Casa Central")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reclamar QR" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Elegí la sucursal/);
    expect(posted).toBe(false);
  });

  it("ADMIN: POST /api/qr/claim con el qrId de la URL + sucursal/nombre/destino, y muestra la confirmación", async () => {
    let body: unknown;
    server.use(
      branchesHandler(),
      http.post(claimUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode({ id: QR_ID, displayNumber: 4, name: "Vidriera" }), {
          status: 201,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/claim/${QR_ID}`);
    await waitFor(() => expect(screen.getByText("Casa Central")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");
    await user.type(screen.getByLabelText("Nombre"), "Vidriera");
    await user.type(screen.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(screen.getByRole("button", { name: "Reclamar QR" }));

    expect(await screen.findByText("¡Listo!")).toBeInTheDocument();
    expect(screen.getByText("QR 4 — Vidriera")).toBeInTheDocument();
    expect(body).toEqual({
      qrId: QR_ID,
      branchId: "b1",
      name: "Vidriera",
      destinationUrl: "https://g.page/r/x/review",
      message: null,
    });
    // Sin qrType: un QR físico es siempre REUSABLE, el contrato no lo acepta.
    expect(body).not.toHaveProperty("qrType");

    await user.click(screen.getByRole("link", { name: "Ir a mis códigos QR" }));
    expect(screen.getByText("lista de qr")).toBeInTheDocument();
  });

  it("QR ya reclamado o inexistente → el mensaje genérico del backend, tal cual", async () => {
    server.use(
      branchesHandler(),
      http.post(claimUrl, () =>
        HttpResponse.json({ error: { message: "QR ya reclamado o no existe" } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage(`/claim/${QR_ID}`);
    await waitFor(() => expect(screen.getByText("Casa Central")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");
    await user.type(screen.getByLabelText("Nombre"), "Vidriera");
    await user.type(screen.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(screen.getByRole("button", { name: "Reclamar QR" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("QR ya reclamado o no existe");
    expect(screen.queryByText("¡Listo!")).not.toBeInTheDocument();
  });

  it("un qrId que no es uuid muestra el MISMO mensaje genérico, sin formulario ni request", async () => {
    let posted = false;
    server.use(
      branchesHandler(),
      http.post(claimUrl, () => {
        posted = true;
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );

    renderPage("/claim/no-es-un-uuid");

    expect(screen.getByRole("alert")).toHaveTextContent("QR ya reclamado o no existe");
    expect(screen.queryByRole("button", { name: "Reclamar QR" })).not.toBeInTheDocument();
    expect(posted).toBe(false);
  });
});
