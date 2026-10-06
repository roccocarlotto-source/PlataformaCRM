import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { OrganizationMetaConnectionCard } from "./OrganizationMetaConnectionCard";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// La conexión con Facebook de una organización elegida, del lado de la
// plataforma (02/10/2026: hasta entonces era la sección "Facebook e
// Instagram" de Configuración → Organización, y estos casos vivían en
// organization/MetaConnectionSection.test.tsx). Mismos casos que la sección de
// Google Calendar en BranchFormPage.test.tsx, sin el de "conectando" (pestaña
// nueva + volver a consultar), que acá no existe: al conectar se navega esta
// misma pestaña.
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const baseUrl = `${env.apiUrl}/api/admin/organizations/${ORG}/integrations/meta`;

function renderSection(resultadoDelCallback?: {
  error: string | null;
  pendiente?: { code: string; state: string } | null;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationMetaConnectionCard
        organizationId={ORG}
        resultadoDelCallback={
          resultadoDelCallback && {
            error: resultadoDelCallback.error,
            pendiente: resultadoDelCallback.pendiente ?? null,
          }
        }
      />
    </QueryClientProvider>,
  );
}

function sinConectar() {
  return http.get(baseUrl, () =>
    HttpResponse.json(
      { error: { message: "Esta organización no tiene una página de Facebook conectada" } },
      { status: 404 },
    ),
  );
}

function conexion(overrides: Record<string, unknown> = {}) {
  return {
    id: "mc1",
    organizationId: ORG,
    pageId: "104857600000001",
    instagramBusinessAccountId: null,
    pageName: null,
    instagramUsername: null,
    status: "ACTIVE",
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

// jsdom no navega: se reemplaza window.location por un objeto que registra
// lo que se asigna a href, y se restaura después de cada test.
const locationOriginal = window.location;
function espiarNavegacion() {
  const asignaciones: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...locationOriginal,
      get href() {
        return asignaciones.at(-1) ?? locationOriginal.href;
      },
      set href(url: string) {
        asignaciones.push(url);
      },
    },
  });
  return asignaciones;
}

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: locationOriginal });
});

describe("OrganizationMetaConnectionCard", () => {
  it("sin conectar (404): Conectar navega ESTA pestaña a la URL de Meta, sin abrir otra", async () => {
    let posts = 0;
    const asignaciones = espiarNavegacion();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    server.use(
      sinConectar(),
      http.post(`${baseUrl}/connect`, () => {
        posts += 1;
        return HttpResponse.json({
          authorizationUrl: "https://www.facebook.com/v21.0/dialog/oauth?x=1",
        });
      }),
    );
    renderSection();

    expect(await screen.findByText("Sin conectar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Conectar con Facebook" }));

    await waitFor(() =>
      expect(asignaciones).toEqual(["https://www.facebook.com/v21.0/dialog/oauth?x=1"]),
    );
    expect(posts).toBe(1);
    expect(openSpy).not.toHaveBeenCalled();
    // Mientras la pestaña navega, el botón no firma un segundo state.
    expect(screen.getByRole("button", { name: "Abriendo Facebook…" })).toBeDisabled();
    openSpy.mockRestore();
  });

  it("conectada: muestra la página y el Instagram vinculado; Desconectar pregunta antes y manda el DELETE", async () => {
    let deletes = 0;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const user = userEvent.setup();
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          deletes === 0
            ? conexion({ instagramBusinessAccountId: "17841400000000001" })
            : conexion({ status: "REVOKED" }),
        ),
      ),
      http.delete(baseUrl, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSection();

    expect(await screen.findByText("Conectada")).toBeInTheDocument();
    expect(screen.getByText("104857600000001")).toBeInTheDocument();
    expect(screen.getByText("17841400000000001")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Messenger y por Instagram/));
    expect(deletes).toBe(0);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(deletes).toBe(1));
    // Se vuelve a consultar, y una conexión REVOKED se lee como sin conectar.
    expect(
      await screen.findByRole("button", { name: "Conectar con Facebook" }),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("conectada: «Volver a conectar» repite el flujo de conectar sin desconectar (vuelve a suscribir la página)", async () => {
    let posts = 0;
    let deletes = 0;
    const asignaciones = espiarNavegacion();
    const user = userEvent.setup();
    server.use(
      http.get(baseUrl, () => HttpResponse.json(conexion())),
      http.post(`${baseUrl}/connect`, () => {
        posts += 1;
        return HttpResponse.json({
          authorizationUrl: "https://www.facebook.com/v25.0/dialog/oauth?reconectar=1",
        });
      }),
      http.delete(baseUrl, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSection();

    expect(await screen.findByText("Conectada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver a conectar" }));

    await waitFor(() =>
      expect(asignaciones).toEqual(["https://www.facebook.com/v25.0/dialog/oauth?reconectar=1"]),
    );
    expect(posts).toBe(1);
    expect(deletes).toBe(0);
    expect(screen.getByRole("button", { name: "Abriendo Facebook…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeDisabled();
  });

  it("conectada sin Instagram vinculado lo dice", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(conexion())));
    renderSection();

    expect(await screen.findByText(/sin cuenta vinculada/)).toBeInTheDocument();
  });

  it("una conexión en ERROR dice por qué y ofrece reconectar", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          conexion({ status: "ERROR", lastErrorMessage: "El token de la página venció" }),
        ),
      ),
    );
    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La conexión dejó de funcionar: El token de la página venció",
    );
    expect(screen.getByRole("button", { name: "Conectar con Facebook" })).toBeInTheDocument();
  });

  it("si iniciar la conexión falla, se muestra el error y no se navega", async () => {
    const asignaciones = espiarNavegacion();
    const user = userEvent.setup();
    server.use(
      sinConectar(),
      http.post(`${baseUrl}/connect`, () =>
        HttpResponse.json(
          { error: { message: "La integración con Meta no está configurada" } },
          { status: 500 },
        ),
      ),
    );
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Conectar con Facebook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos iniciar la conexión: La integración con Meta no está configurada",
    );
    expect(asignaciones).toEqual([]);
  });

  // A-07 de docs-privados/auditoria-2026-09-30-corta.md (local): el callback
  // ya no conecta; vuelve con el code y el state y esta sección los manda con
  // la sesión de quien está logueado.
  it("la vuelta del callback con code y state los manda UNA vez a /complete y avisa que quedó conectada", async () => {
    const enviados: unknown[] = [];
    let conectada = false;
    server.use(
      http.get(baseUrl, () =>
        conectada
          ? HttpResponse.json(conexion())
          : HttpResponse.json({ error: { message: "Sin conexión" } }, { status: 404 }),
      ),
      http.post(`${baseUrl}/complete`, async ({ request }) => {
        enviados.push(await request.json());
        conectada = true;
        return HttpResponse.json(conexion());
      }),
    );
    const { rerender } = renderSection({
      error: null,
      pendiente: { code: "el-code", state: "el-state" },
    });

    expect(await screen.findByText("La página de Facebook quedó conectada.")).toBeInTheDocument();
    // Tras conectar se vuelve a consultar la conexión.
    expect(await screen.findByText("104857600000001")).toBeInTheDocument();
    // Un re-render con las mismas props no vuelve a mandar nada.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationMetaConnectionCard
          organizationId={ORG}
          resultadoDelCallback={{ error: null, pendiente: { code: "el-code", state: "el-state" } }}
        />
      </QueryClientProvider>,
    );
    expect(enviados).toEqual([{ code: "el-code", state: "el-state" }]);
  });

  it.each([
    [
      403,
      "Esta conexión con Facebook la empezó otro usuario o se abrió en otra sesión. Volvé a tocar «Conectar con Facebook» desde tu cuenta.",
    ],
    [
      400,
      "Facebook no aceptó la autorización porque venció o ya se había usado. Volvé a tocar «Conectar con Facebook».",
    ],
  ])(
    "si completar falla (%i: sesión que no coincide o code vencido) muestra el mensaje para reintentar y deja Conectar",
    async (status, mensaje) => {
      server.use(
        sinConectar(),
        http.post(`${baseUrl}/complete`, () =>
          HttpResponse.json({ error: { message: mensaje } }, { status }),
        ),
      );
      renderSection({ error: null, pendiente: { code: "c", state: "s" } });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `No pudimos conectar Facebook: ${mensaje}`,
      );
      expect(screen.queryByText("La página de Facebook quedó conectada.")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Conectar con Facebook" })).toBeEnabled();
    },
  );

  it("la vuelta del callback con metaError se muestra aunque no haya conexión guardada", async () => {
    server.use(sinConectar());
    renderSection({
      error: "Autorizaste más de una página. Este negocio conecta una sola página de Facebook.",
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos conectar Facebook: Autorizaste más de una página.",
    );
    expect(
      await screen.findByRole("button", { name: "Conectar con Facebook" }),
    ).toBeInTheDocument();
  });
});
