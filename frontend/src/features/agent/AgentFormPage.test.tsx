import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAgent } from "../../test/agentFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AgentFormPage } from "./AgentFormPage";

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

const baseUrl = `${env.apiUrl}/api/agents`;
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
          <Route path="/agents/new" element={<AgentFormPage />} />
          <Route path="/agents/:id/edit" element={<AgentFormPage />} />
          <Route path="/agents" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Escribe el JSON de los guardrails de una sola vez. NO se usa user.type:
// esa API lee "{" y "[" como el comienzo de un descriptor de tecla
// ("{Escape}"), así que un JSON habría que escaparlo entero y el test dejaría
// de parecerse a lo que se quiere probar. Pegar es además lo que una persona
// hace de verdad con un objeto de configuración.
async function escribirGuardrails(user: ReturnType<typeof userEvent.setup>, texto: string) {
  const campo = screen.getByLabelText("Guardrails (JSON)");
  await user.clear(campo);
  await user.click(campo);
  await user.paste(texto);
}

// Los tres campos sin los que el POST no puede salir.
async function completarMinimo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Asistente de ventas");
  await user.type(screen.getByLabelText("Instrucciones"), "Contestá corto.");
  await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
  await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
}

describe("AgentFormPage — creación", () => {
  it("manda el POST con los campos del formulario y los guardrails ya parseados a objeto", async () => {
    const bodies: unknown[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");

    await completarMinimo(user);
    await user.type(screen.getByLabelText("Objetivo"), "Calificar el lead");
    await user.type(screen.getByLabelText("Tono"), "cercano");
    await user.type(screen.getByLabelText("Modelo"), "openai/gpt-4o-mini");

    // El textarea arranca en "{}" (default de creación): se reemplaza entero.
    await escribirGuardrails(user, '{"accionesProhibidas": ["update_opportunity"]}');

    await user.click(screen.getByLabelText("Canales", { selector: "button" }));
    await user.click(screen.getByRole("checkbox", { name: "WhatsApp" }));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        branchId: "b2",
        name: "Asistente de ventas",
        goal: "Calificar el lead",
        instructions: "Contestá corto.",
        tone: "cercano",
        modelProvider: "openrouter",
        modelName: "openai/gpt-4o-mini",
        enabledTools: [],
        channels: ["WHATSAPP"],
        // Objeto, no el string del textarea.
        guardrails: { accionesProhibidas: ["update_opportunity"] },
        isActive: true,
      },
    ]);
  });

  it("sin Modelo el POST sale SIN la clave: el backend usa el modelo por defecto", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // Ausente, no null ni "": el campo es .default() y no .nullable(), así que
    // mandarlo vacío sería un 400.
    expect("modelName" in bodies[0]).toBe(false);
    // Los opcionales vacíos sí viajan, como null.
    expect(bodies[0].goal).toBeNull();
    expect(bodies[0].tone).toBeNull();
    // Y allowedOrigins NO viaja nunca: esta pantalla no configura el widget.
    expect("allowedOrigins" in bodies[0]).toBe(false);
  });

  it("el proveedor viene elegido y hoy ofrece una sola opción", async () => {
    server.use(mockBranches());
    renderForm("/agents/new");

    expect(screen.getByLabelText("Proveedor")).toHaveValue("OpenRouter");
  });

  it("las tools muestran la descripción completa que lee el modelo, no solo el nombre", async () => {
    server.use(mockBranches());
    const user = userEvent.setup();
    renderForm("/agents/new");

    await user.click(screen.getByLabelText("Acciones habilitadas", { selector: "button" }));

    // El nombre accesible del checkbox es SOLO el rótulo corto (la descripción
    // va como aria-describedby), y la descripción está visible en la lista.
    expect(screen.getByRole("checkbox", { name: "Crear oportunidad" })).toBeInTheDocument();
    expect(
      screen.getByText(/Crea una oportunidad de venta para el contacto de esta conversación/),
    ).toBeInTheDocument();
  });

  it("las tools viajan en el orden del catálogo, no en el de los clicks", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);

    await user.click(screen.getByLabelText("Acciones habilitadas", { selector: "button" }));
    await user.click(screen.getByRole("checkbox", { name: "Reservar turno" }));
    await user.click(screen.getByRole("checkbox", { name: "Crear oportunidad" }));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].enabledTools).toEqual(["create_opportunity", "create_booking"]);
  });

  it("un JSON roto en los guardrails se frena en el cliente, sin pegarle al backend", async () => {
    let llamadas = 0;
    server.use(
      mockBranches(),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);

    await escribirGuardrails(user, '{"temasProhibidos": [');

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Los guardrails tienen que ser un JSON válido/,
    );
    expect(llamadas).toBe(0);
  });

  it("una lista tampoco pasa: los guardrails tienen que ser un objeto", async () => {
    server.use(mockBranches());
    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);

    await escribirGuardrails(user, '["update_opportunity"]');

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/objeto JSON/);
  });

  it("guardar mientras las sucursales cargan avisa que falta la sucursal, y no manda nada", async () => {
    // Mientras la lista carga, BranchSelect no renderiza ningún input: el
    // `required` no existe todavía y el navegador no tiene qué frenar. Ese es
    // el hueco que cubre validar().
    let llamadas = 0;
    server.use(
      http.get(branchesUrl, () => new Promise(() => undefined)),
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await user.type(screen.getByLabelText("Nombre"), "Asistente");
    await user.type(screen.getByLabelText("Instrucciones"), "Contestá corto.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elegí la sucursal a la que pertenece este agente.",
    );
    expect(llamadas).toBe(0);
  });

  it("el error del backend se muestra tal cual", async () => {
    server.use(
      mockBranches(),
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "La sucursal indicada no existe o no pertenece a tu organización" } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La sucursal indicada no existe o no pertenece a tu organización",
    );
  });
});

describe("AgentFormPage — edición", () => {
  function mockAgentDetalle(overrides = {}) {
    return http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeAgent(overrides)));
  }

  it("hidrata los campos, con los guardrails formateados para poder leerlos", async () => {
    server.use(
      mockBranches(),
      mockAgentDetalle({
        name: "Asistente de ventas",
        goal: "Calificar el lead",
        tone: "cercano",
        modelName: "openai/gpt-4o-mini",
        guardrails: { accionesProhibidas: ["update_opportunity"] },
      }),
    );

    renderForm("/agents/ag1/edit");

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Asistente de ventas");
    expect(screen.getByLabelText("Objetivo")).toHaveValue("Calificar el lead");
    expect(screen.getByLabelText("Tono")).toHaveValue("cercano");
    expect(screen.getByLabelText("Modelo")).toHaveValue("openai/gpt-4o-mini");
    // Indentado, no en una línea.
    expect(screen.getByLabelText("Guardrails (JSON)")).toHaveValue(
      '{\n  "accionesProhibidas": [\n    "update_opportunity"\n  ]\n}',
    );
  });

  it("la sucursal se ve, con su nombre, pero no se puede cambiar", async () => {
    server.use(mockBranches(), mockAgentDetalle({ branchId: "b2" }));

    renderForm("/agents/ag1/edit");

    const sucursal = await screen.findByLabelText("Sucursal");
    expect(sucursal).toHaveValue("Sucursal Chuy");
    expect(sucursal).toBeDisabled();
    expect(
      screen.getByText(/La sucursal no se puede cambiar: las conversaciones/),
    ).toBeInTheDocument();
  });

  it("el PATCH manda todos los campos, sin branchId ni allowedOrigins", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      mockAgentDetalle(),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");

    const nombre = await screen.findByLabelText("Nombre");
    await user.clear(nombre);
    await user.type(nombre, "Asistente renombrado");
    await user.click(screen.getByLabelText("Activo"));

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: "Asistente renombrado",
        goal: "Atender consultas de la web y calificar el lead",
        instructions: "Sos el asistente de una concesionaria. Contestá corto y ofrecé un turno.",
        tone: "cercano",
        modelProvider: "openrouter",
        modelName: "openai/gpt-4o-mini",
        enabledTools: ["create_lead"],
        channels: ["WEB"],
        guardrails: {},
        isActive: false,
      },
    ]);
    // branchId no está en updateAgentSchema: mandarlo sería un 400.
    expect("branchId" in bodies[0]).toBe(false);
    // Omitir allowedOrigins es lo que deja intacta la configuración del widget:
    // mandarlo como [] la borraría.
    expect("allowedOrigins" in bodies[0]).toBe(false);
  });

  it("una tool que ya no está en el catálogo se conserva, no la borra el PATCH", async () => {
    // El backend valida la FORMA del nombre, no su pertenencia al catálogo, así
    // que una fila puede traer una tool que esta versión del frontend no
    // conoce. Sin ofrecerla como opción, el MultiSelect la mostraría como no
    // elegida y el PATCH la sacaría sin que nadie lo haya pedido.
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      mockAgentDetalle({ enabledTools: ["create_lead", "tool_del_futuro"] }),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");
    await screen.findByLabelText("Nombre");

    await user.click(screen.getByLabelText("Acciones habilitadas", { selector: "button" }));
    expect(screen.getByRole("checkbox", { name: "tool_del_futuro" })).toBeChecked();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].enabledTools).toEqual(["create_lead", "tool_del_futuro"]);
  });

  it("vaciar el Modelo se frena en el cliente: borrarlo no vuelve al modelo por defecto", async () => {
    let llamadas = 0;
    server.use(
      mockBranches(),
      mockAgentDetalle(),
      http.patch(`${baseUrl}/:id`, () => {
        llamadas += 1;
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");

    await user.clear(await screen.findByLabelText("Modelo"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/El modelo no puede quedar vacío/);
    expect(llamadas).toBe(0);
  });

  it("estado de carga y error del detalle", async () => {
    server.use(
      mockBranches(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
      ),
    );

    renderForm("/agents/ag1/edit");

    expect(await screen.findByRole("alert")).toHaveTextContent("Agente no encontrado");
  });
});

// Misma jerarquía real que app/router.tsx, igual que en AgentListPage.test.tsx.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/agents/new" element={<AgentFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentFormPage — bajo AdminRoute", () => {
  it("un USER entrando a /agents/new es redirigido", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(mockBranches());

    renderUnderAdminRoute("/agents/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Nuevo agente" })).not.toBeInTheDocument();
  });

  it("un ADMIN sí ve el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(mockBranches());

    renderUnderAdminRoute("/agents/new");

    expect(await screen.findByRole("heading", { name: "Nuevo agente" })).toBeInTheDocument();
  });
});
