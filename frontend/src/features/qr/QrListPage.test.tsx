import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeQrCode } from "../../test/qrFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { QrListPage } from "./QrListPage";
import type { QrCodeListResponse } from "./types";

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

const qrUrl = `${env.apiUrl}/api/qr`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function listResponse(overrides: Partial<QrCodeListResponse> = {}): QrCodeListResponse {
  return {
    data: [makeQrCode()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

function branchesHandler(branches = [makeBranch({ id: "b1", name: "Casa Central" })]) {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: branches,
      pagination: { page: 1, pageSize: 100, total: branches.length, totalPages: 1 },
    }),
  );
}

function renderPage(role: "ADMIN" | "USER" = "ADMIN") {
  useAuthMock.mockReturnValue(mockAuth(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/qr"]}>
        <QrListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QrListPage — listado", () => {
  it("muestra número, nombre, NOMBRE de sucursal (no el uuid), estado derivado, destino y tipo", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    await waitFor(() => expect(tabla.getByText("Casa Central")).toBeInTheDocument());
    expect(tabla.queryByText("b1")).not.toBeInTheDocument();
    expect(tabla.getByText("1")).toBeInTheDocument();
    expect(tabla.getByText("Mostrador")).toBeInTheDocument();
    expect(tabla.getByText("Activo")).toBeInTheDocument();
    expect(tabla.getByText("https://g.page/r/abc/review")).toBeInTheDocument();
    expect(tabla.getByText("Reusable")).toBeInTheDocument();
  });

  it("el estado se DERIVA: single-use con usedAt → Usado; sin claimedAt → Sin reclamar", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeQrCode({ id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11", displayNumber: 1 }),
              makeQrCode({
                id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a12",
                displayNumber: 2,
                qrType: "SINGLE_USE",
                usedAt: "2026-02-01T00:00:00.000Z",
              }),
              makeQrCode({
                id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a13",
                displayNumber: 3,
                qrType: "SINGLE_USE",
                usedAt: null,
              }),
              makeQrCode({
                id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a14",
                displayNumber: 4,
                claimedAt: null,
              }),
            ],
            pagination: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getAllByText("Activo")).toHaveLength(2);
    expect(tabla.getByText("Usado")).toBeInTheDocument();
    expect(tabla.getByText("Sin reclamar")).toBeInTheDocument();
    expect(tabla.getAllByText("Un solo uso")).toHaveLength(2);
  });

  it("un QR cuya sucursal no está entre las cargadas muestra un guion, no rompe la fila", async () => {
    server.use(
      branchesHandler([]),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    await waitFor(() => expect(tabla.getByText("—")).toBeInTheDocument());
    expect(tabla.getByText("Mostrador")).toBeInTheDocument();
  });

  it("estado vacío", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );

    renderPage();

    expect(await screen.findByText("Todavía no hay códigos QR para mostrar.")).toBeInTheDocument();
  });

  it("error del listado", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json({ error: { message: "se cayó" } }, { status: 500 })),
    );

    renderPage();

    expect(
      await screen.findByText(/No pudimos cargar los códigos QR: se cayó/),
    ).toBeInTheDocument();
  });

  it("el filtro de sucursal viaja como branchId y vuelve a página 1", async () => {
    const captured: URL[] = [];
    server.use(
      branchesHandler(),
      http.get(qrUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await screen.findByRole("option", { name: "Casa Central" });
    await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");

    await waitFor(() => {
      const last = captured[captured.length - 1];
      expect(last.searchParams.get("branchId")).toBe("b1");
      expect(last.searchParams.get("page")).toBe("1");
    });
    expect(captured[0].searchParams.has("branchId")).toBe(false);
  });
});

describe("QrListPage — acciones por rol", () => {
  it("ADMIN ve Generar/Editar/Eliminar además de las de solo lectura", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage("ADMIN");

    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Generar QR digital" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver imagen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
  });

  it("USER no ve escrituras pero SÍ ver imagen / enviar / copiar link", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage("USER");

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Generar QR digital" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver imagen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
  });
});

describe("QrListPage — eliminar", () => {
  it("con confirmación, DELETE /api/qr/:id y refresca el listado", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let deletedId: string | undefined;
    let gets = 0;
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => {
        gets += 1;
        return HttpResponse.json(listResponse());
      }),
      http.delete(`${qrUrl}/:id`, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(deletedId).toBe("d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11"));
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it("sin confirmación, no llama al backend", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    let deleted = false;
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
      http.delete(`${qrUrl}/:id`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(deleted).toBe(false);
  });
});

describe("QrListPage — copiar link", () => {
  it("copia la URL pública de resolución (${env.qrPublicBaseUrl}/r/:id, contra el Worker) y confirma", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    // userEvent.setup() instala un portapapeles real en jsdom.
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(await screen.findByRole("button", { name: "¡Copiado!" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      `${env.qrPublicBaseUrl}/r/d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11`,
    );
  });

  it("si el portapapeles falla, muestra el link para copiarlo a mano", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denegado"));
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(await screen.findByText(/Copialo a mano/)).toBeInTheDocument();
    expect(
      screen.getByText(`${env.qrPublicBaseUrl}/r/d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "¡Copiado!" })).not.toBeInTheDocument();
  });
});

describe("QrListPage — diálogos", () => {
  it("Generar QR digital abre el formulario; al crear, cierra el formulario y abre la imagen del QR nuevo", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
      http.post(`${qrUrl}/digital`, () =>
        HttpResponse.json(
          makeQrCode({
            id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a99",
            displayNumber: 7,
            name: "Caja",
          }),
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Generar QR digital" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Generar QR digital")).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByText("Casa Central")).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText("Sucursal"), "b1");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    // El diálogo de imagen del QR recién creado reemplaza al formulario.
    await waitFor(() => expect(screen.getByText("QR 7 — Caja")).toBeInTheDocument());
    expect(screen.queryByText("Generar QR digital", { selector: "h2" })).not.toBeInTheDocument();
  });

  it("Editar abre el formulario hidratado con la fila, sin sucursal ni tipo", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Editar" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Mostrador");
    expect(dialog.getByLabelText("Enlace de destino")).toHaveValue("https://g.page/r/abc/review");
    expect(dialog.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(dialog.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("Enviar abre el diálogo de envío; Cancelar lo cierra", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("radiogroup", { name: "Canal de envío" })).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
