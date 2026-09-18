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
import { openActionsMenu } from "../../test/openActionsMenu";
import type { AuthContextValue } from "../../auth/AuthContext";
import { QrListPage } from "./QrListPage";
import type { QrCodeListResponse } from "./types";
import { chooseSelectOption } from "../../test/chooseSelectOption";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

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
  it("muestra número, nombre, NOMBRE de sucursal (no el uuid) y destino", async () => {
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
    expect(tabla.getByText("https://g.page/r/abc/review")).toBeInTheDocument();
    // Las columnas Estado y Tipo se sacaron en el ítem 53: derivaban de
    // claimedAt/usedAt/qrType, que el backend no manda desde la migración
    // 20260904120000, así que decían "Activo" y "Reusable" en todas las filas.
    expect(tabla.queryByText("Activo")).not.toBeInTheDocument();
    expect(tabla.queryByText("Reusable")).not.toBeInTheDocument();
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
    await screen.findByRole("combobox", { name: "Sucursal" });
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Casa Central");

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
    // Las seis acciones de fila viven en el menú de 3 puntos (§8), en este
    // orden: las de solo lectura primero (Ver detalle al frente, §28), las de
    // escritura al final.
    await openActionsMenu(userEvent.setup());
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Ver detalle",
      "Ver imagen",
      "Enviar",
      "Copiar link",
      "Editar",
      "Eliminar",
    ]);
  });

  it("USER no ve escrituras pero SÍ ver imagen / enviar / copiar link", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage("USER");

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Generar QR digital" })).not.toBeInTheDocument();
    await openActionsMenu(userEvent.setup());
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Ver detalle",
      "Ver imagen",
      "Enviar",
      "Copiar link",
    ]);
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
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

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
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

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
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Copiar link" }));

    // El menú sigue abierto (keepOpen) y el ítem pasa a decir "¡Copiado!".
    expect(await screen.findByRole("menuitem", { name: "¡Copiado!" })).toBeInTheDocument();
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
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Copiar link" }));

    expect(await screen.findByText(/Copialo a mano/)).toBeInTheDocument();
    expect(
      screen.getByText(`${env.qrPublicBaseUrl}/r/d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "¡Copiado!" })).not.toBeInTheDocument();
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
    await dialog.findByRole("combobox", { name: "Sucursal" });
    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    // El diálogo de imagen del QR recién creado reemplaza al formulario.
    await waitFor(() => expect(screen.getByText("QR 7 — Caja")).toBeInTheDocument());
    expect(screen.queryByText("Generar QR digital", { selector: "h2" })).not.toBeInTheDocument();
  });

  it("Editar abre el formulario hidratado con la fila, sin sucursal", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Mostrador");
    expect(dialog.getByLabelText("Enlace de destino")).toHaveValue("https://g.page/r/abc/review");
    expect(dialog.queryByLabelText("Sucursal")).not.toBeInTheDocument();
  });

  it("Enviar abre el diálogo de envío; Cancelar lo cierra", async () => {
    server.use(
      branchesHandler(),
      http.get(qrUrl, () => HttpResponse.json(listResponse())),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table");
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Enviar" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("radiogroup", { name: "Canal de envío" })).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// "Ver detalle" (docs/frontend-cambios-pendientes.md §28): pop up de solo
// lectura con los datos del QR —no la imagen—, desde la fila ya cargada.
// ---------------------------------------------------------------------------
describe("QrListPage — ver detalle", () => {
  it("abre el pop up con los datos del registro (sucursal por nombre, mensaje, fecha de creación); cierra con × y con Escape", async () => {
    const createdAt = "2026-01-15T14:30:00.000Z";
    server.use(
      branchesHandler(),
      http.get(qrUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [makeQrCode({ message: "Gracias por su visita", createdAt })],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage("USER");

    await screen.findByRole("table");
    await openActionsMenu(user);
    expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Ver detalle");
    await user.click(screen.getByRole("menuitem", { name: "Ver detalle" }));

    const dialog = await screen.findByRole("dialog", { name: "Detalle del QR" });
    expect(dialog).toHaveTextContent("Mostrador");
    expect(dialog).toHaveTextContent("Casa Central");
    expect(dialog).not.toHaveTextContent("b1");
    expect(dialog).toHaveTextContent("https://g.page/r/abc/review");
    expect(dialog).toHaveTextContent("Gracias por su visita");
    expect(dialog).toHaveTextContent(new Date(createdAt).toLocaleString());
    // Ítem 53: las filas Estado, Tipo, "Reclamado el" y "Usado el" ya no
    // están. Las dos primeras eran badges fijos y las dos fechas mostraban
    // siempre "—", porque sus columnas no existen desde la migración
    // 20260904120000.
    expect(within(dialog).queryByText("Activo")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Reusable")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Reclamado el");
    expect(dialog).not.toHaveTextContent("Usado el");
    // Es el detalle, no la imagen: sin <img> ni <svg> del código adentro.
    expect(dialog.querySelector("img, svg.qr")).toBeNull();
    expect(dialog.querySelectorAll("input, select, textarea")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Cerrar diálogo" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Ver detalle" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
