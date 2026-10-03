import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { makeAgent } from "../../test/agentFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { AgentFacebookPagePage } from "./AgentFacebookPagePage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// Plataforma → Página de Facebook. Arriba, la conexión de la página con una
// organización elegida (02/10/2026: la hace el platform admin); debajo, la
// asignación de la página a un agente (ítem 173). Que un no platform admin no
// la vea lo fijan router.test.tsx (PlatformAdminRoute), PlatformAdminRoute
// .test.tsx y AppLayout.test.tsx (el link del menú). Los estados de la tarjeta
// de conexión, OrganizationMetaConnectionCard.test.tsx.
// ---------------------------------------------------------------------------

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const url = `${env.apiUrl}/api/admin/agents/:agentId/facebook-page`;
const metaUrl = `${env.apiUrl}/api/admin/organizations/:organizationId/integrations/meta`;

function conexion(organizationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "mc1",
    organizationId,
    pageId: "104857600000001",
    instagramBusinessAccountId: "17841400000000001",
    status: "ACTIVE",
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

// La URL que la pantalla deja después de leer la vuelta del callback.
let ultimaUbicacion = "";
function Ubicacion() {
  const location = useLocation();
  useEffect(() => {
    ultimaUbicacion = `${location.pathname}${location.search}${location.hash}`;
  }, [location]);
  return null;
}

function renderPage(initialEntry = "/admin/agents/facebook-page") {
  server.use(
    http.get(`${env.apiUrl}/api/admin/organizations`, () =>
      HttpResponse.json([
        { id: ORG_A, name: "Concesionaria Ejemplo", slug: "concesionaria-ejemplo" },
        { id: ORG_B, name: "Taller Ficticio", slug: "taller-ficticio" },
      ]),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AgentFacebookPagePage />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// jsdom no navega: se reemplaza window.location por un objeto que registra lo
// que se asigna a href, y se restaura después de cada test.
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
      set href(nueva: string) {
        asignaciones.push(nueva);
      },
    },
  });
  return asignaciones;
}

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: locationOriginal });
});

describe("AgentFacebookPagePage — conexión de la organización (02/10/2026)", () => {
  it("sin organización elegida no consulta ninguna conexión; al elegir una muestra su estado", async () => {
    const consultadas: unknown[] = [];
    server.use(
      http.get(metaUrl, ({ params }) => {
        consultadas.push(params.organizationId);
        return HttpResponse.json(conexion(String(params.organizationId)));
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const selector = await screen.findByRole("combobox", { name: "Organización" });
    expect(consultadas).toEqual([]);

    await chooseSelectOption(user, selector, "Concesionaria Ejemplo");

    expect(await screen.findByText("Conectada")).toBeInTheDocument();
    expect(screen.getByText("17841400000000001")).toBeInTheDocument();
    expect(consultadas).toEqual([ORG_A]);
    expect(ultimaUbicacion).toBe(`/admin/agents/facebook-page?organizationId=${ORG_A}`);
  });

  it("Conectar firma el state para la organización elegida y navega ESTA pestaña a Meta", async () => {
    const asignaciones = espiarNavegacion();
    const conectadas: unknown[] = [];
    server.use(
      http.get(metaUrl, () => HttpResponse.json({ error: { message: "x" } }, { status: 404 })),
      http.post(`${metaUrl}/connect`, ({ params }) => {
        conectadas.push(params.organizationId);
        return HttpResponse.json({
          authorizationUrl: "https://www.facebook.com/v25.0/dialog/oauth?x=1",
        });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/agents/facebook-page?organizationId=${ORG_B}`);

    await user.click(await screen.findByRole("button", { name: "Conectar con Facebook" }));

    await waitFor(() =>
      expect(asignaciones).toEqual(["https://www.facebook.com/v25.0/dialog/oauth?x=1"]),
    );
    expect(conectadas).toEqual([ORG_B]);
  });

  it("Desconectar pregunta antes y manda el DELETE de la organización elegida", async () => {
    const borradas: unknown[] = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    server.use(
      http.get(metaUrl, ({ params }) =>
        HttpResponse.json(
          conexion(String(params.organizationId), {
            status: borradas.length === 0 ? "ACTIVE" : "REVOKED",
          }),
        ),
      ),
      http.delete(metaUrl, ({ params }) => {
        borradas.push(params.organizationId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage(`/admin/agents/facebook-page?organizationId=${ORG_A}`);

    await user.click(await screen.findByRole("button", { name: "Desconectar" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Messenger y por Instagram/));
    await waitFor(() => expect(borradas).toEqual([ORG_A]));
    expect(
      await screen.findByRole("button", { name: "Conectar con Facebook" }),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("la vuelta del callback completa UNA vez para la organización con la que volvió y limpia el fragmento", async () => {
    const completadas: { organizationId: unknown; body: unknown }[] = [];
    let conectada = false;
    server.use(
      http.get(metaUrl, ({ params }) =>
        conectada
          ? HttpResponse.json(conexion(String(params.organizationId)))
          : HttpResponse.json({ error: { message: "x" } }, { status: 404 }),
      ),
      http.post(`${metaUrl}/complete`, async ({ request, params }) => {
        completadas.push({ organizationId: params.organizationId, body: await request.json() });
        conectada = true;
        return HttpResponse.json(conexion(String(params.organizationId)));
      }),
    );
    renderPage(
      `/admin/agents/facebook-page?organizationId=${ORG_A}#metaCode=el-code&metaState=el-state`,
    );

    expect(await screen.findByText("La página de Facebook quedó conectada.")).toBeInTheDocument();
    expect(await screen.findByText("Conectada")).toBeInTheDocument();
    expect(completadas).toEqual([
      { organizationId: ORG_A, body: { code: "el-code", state: "el-state" } },
    ]);
    // El code y el state no quedan en la URL; la organización sí.
    await waitFor(() =>
      expect(ultimaUbicacion).toBe(`/admin/agents/facebook-page?organizationId=${ORG_A}`),
    );
  });

  it("la vuelta con ?metaError= lo muestra en la tarjeta de esa organización", async () => {
    server.use(
      http.get(metaUrl, () => HttpResponse.json({ error: { message: "x" } }, { status: 404 })),
    );
    renderPage(
      `/admin/agents/facebook-page?organizationId=${ORG_A}&metaError=${encodeURIComponent(
        "Se canceló la autorización en Facebook. La página quedó sin conectar.",
      )}`,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos conectar Facebook: Se canceló la autorización en Facebook.",
    );
  });
});

describe("AgentFacebookPagePage — página de un agente (ítem 173)", () => {
  it("PUT con el agente de la URL y la página recortada; muestra el resultado", async () => {
    let body: unknown;
    let agentId: unknown;
    server.use(
      http.put(url, async ({ request, params }) => {
        body = await request.json();
        agentId = params.agentId;
        return HttpResponse.json(
          makeAgent({
            id: AGENT_ID,
            name: "Agente de prueba",
            facebookPageId: "104857600000001",
          }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), ` ${AGENT_ID} `);
    await user.type(screen.getByLabelText("ID de la página de Facebook"), " 104857600000001 ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByRole("heading", { name: "Página asignada a Agente de prueba" }),
    ).toBeInTheDocument();
    expect(agentId).toBe(AGENT_ID);
    expect(body).toEqual({ facebookPageId: "104857600000001" });
    expect(screen.getByText("104857600000001")).toBeInTheDocument();
  });

  it("vacío manda null: libera la página", async () => {
    let body: unknown;
    server.use(
      http.put(url, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeAgent({ id: AGENT_ID, facebookPageId: null }));
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText(/la página quedó libre/)).toBeInTheDocument());
    expect(body).toEqual({ facebookPageId: null });
  });

  it("el error del backend (409 en uso) se muestra y el formulario queda", async () => {
    server.use(
      http.put(url, () =>
        HttpResponse.json(
          { error: { message: "Esa página de Facebook ya está asignada a otro agente" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("ID del agente"), AGENT_ID);
    await user.type(screen.getByLabelText("ID de la página de Facebook"), "104857600000001");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Esa página de Facebook ya está asignada a otro agente"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ID del agente")).toHaveValue(AGENT_ID);
  });
});
