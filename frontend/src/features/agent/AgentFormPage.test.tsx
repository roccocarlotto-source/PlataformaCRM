import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const translateUrl = `${baseUrl}/guardrails/translate`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function mockBranches() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

// El traductor del ítem 56. Registra los cuerpos que recibe: la mitad de lo
// que hay que probar es CUÁNDO se lo llama y cuándo NO — una traducción de más
// es una llamada paga a un LLM por un campo que nadie tocó.
function mockTranslate(
  respuesta: { guardrails: Record<string, unknown>; descartado?: unknown[] },
  registro?: unknown[],
) {
  return http.post(translateUrl, async ({ request }) => {
    registro?.push(await request.json());
    return HttpResponse.json({ descartado: [], ...respuesta });
  });
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

// Escribe los guardrails en lenguaje natural. Se pega en vez de tipear: es lo
// que una persona hace de verdad con un párrafo, y el test no depende de 200
// eventos de teclado.
async function escribirGuardrails(user: ReturnType<typeof userEvent.setup>, texto: string) {
  const campo = screen.getByLabelText("Reglas del agente");
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
  it("manda el POST con los campos del formulario, el texto y el JSON confirmado", async () => {
    const bodies: unknown[] = [];
    const traducciones: unknown[] = [];
    server.use(
      mockBranches(),
      mockTranslate({ guardrails: { accionesProhibidas: ["update_opportunity"] } }, traducciones),
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
    await escribirGuardrails(user, "No modifiques oportunidades.");

    await user.click(screen.getByLabelText("Canales", { selector: "button" }));
    await user.click(screen.getByRole("checkbox", { name: "WhatsApp" }));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Primero el panel: nada se guardó todavía.
    await user.click(await screen.findByRole("button", { name: "Confirmar y guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(traducciones).toEqual([{ text: "No modifiques oportunidades." }]);
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
        // El objeto que devolvió la traducción, TAL CUAL se mostró.
        guardrails: { accionesProhibidas: ["update_opportunity"] },
        // Y el texto que el ADMIN escribió, para poder volver a editarlo.
        guardrailsText: "No modifiques oportunidades.",
        isActive: true,
      },
    ]);
  });

  it("el panel muestra el resumen en español antes de guardar, y todavía no manda nada", async () => {
    let posts = 0;
    server.use(
      mockBranches(),
      mockTranslate({
        guardrails: {
          accionesProhibidas: ["update_opportunity"],
          infoNoModificable: ["email"],
          datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId"] },
        },
      }),
      http.post(baseUrl, () => {
        posts += 1;
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await escribirGuardrails(user, "No modifiques oportunidades ni el mail del contacto.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const panel = await screen.findByRole("dialog");
    // Rótulos en castellano, no nombres de tool crudos.
    expect(
      within(panel).getByText("No puede ejecutar estas acciones: Modificar oportunidad."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("No puede modificar estos datos: email.")).toBeInTheDocument();
    expect(
      within(panel).getByText('Antes de "Reservar turno" tiene que conocer: serviceTypeId.'),
    ).toBeInTheDocument();
    // Y el JSON en crudo, para quien lo quiera revisar.
    expect(within(panel).getByText(/"accionesProhibidas"/)).toBeInTheDocument();

    expect(posts).toBe(0);
  });

  it("lo que no se puede aplicar se muestra como advertencia, no desaparece", async () => {
    server.use(
      mockBranches(),
      mockTranslate({
        guardrails: {},
        descartado: [
          {
            clave: "accionesProhibidas",
            valor: "enviar_email",
            motivo: '"enviar_email" no es ninguna de las acciones del agente',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await escribirGuardrails(user, "No mandes mails.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByText(
        '"enviar_email": "enviar_email" no es ninguna de las acciones del agente.',
      ),
    ).toBeInTheDocument();
    // Y el resumen dice explícitamente que no quedó nada, en vez de una lista
    // vacía que se lee igual que "no se entendió nada".
    expect(within(panel).getByText(/Sin reglas/)).toBeInTheDocument();
  });

  it('"Volver a editar" cierra el panel sin mandar nada y deja el texto intacto', async () => {
    let posts = 0;
    server.use(
      mockBranches(),
      mockTranslate({ guardrails: { infoNoModificable: ["email"] } }),
      http.post(baseUrl, () => {
        posts += 1;
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await escribirGuardrails(user, "No hables de política.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await user.click(await screen.findByRole("button", { name: "Volver a editar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toBe(0);
    expect(screen.getByLabelText("Reglas del agente")).toHaveValue("No hables de política.");
    // Sigue en el formulario: no navegó al listado.
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });

  it("sin texto de guardrails no se traduce nada: el POST sale con {} y texto vacío", async () => {
    let traducciones = 0;
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      http.post(translateUrl, () => {
        traducciones += 1;
        return HttpResponse.json({ guardrails: {}, descartado: [] });
      }),
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
    // Sin panel de confirmación: no hay nada que confirmar.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(traducciones).toBe(0);
    expect(bodies[0].guardrails).toEqual({});
    expect(bodies[0].guardrailsText).toBe("");
  });

  it("si la traducción falla no se guarda nada, y Reintentar vuelve a intentarla", async () => {
    let intentos = 0;
    let posts = 0;
    server.use(
      mockBranches(),
      http.post(translateUrl, () => {
        intentos += 1;
        if (intentos === 1) {
          return HttpResponse.json(
            {
              error: { message: "No se pudo interpretar la traducción del modelo, probá de nuevo" },
            },
            { status: 502 },
          );
        }
        return HttpResponse.json({
          guardrails: { infoNoModificable: ["email"] },
          descartado: [],
        });
      }),
      http.post(baseUrl, () => {
        posts += 1;
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await escribirGuardrails(user, "No hables de política.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Fail closed: el error se ve y NO se guardó un agente con guardrails
    // vacíos por una falla de red.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No se pudo interpretar la traducción del modelo/,
    );
    expect(posts).toBe(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Y lo escrito sigue ahí.
    expect(screen.getByLabelText("Reglas del agente")).toHaveValue("No hables de política.");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(intentos).toBe(2);
    expect(posts).toBe(0);
  });

  it("volver a guardar sin tocar el texto no vuelve a traducir", async () => {
    // El POST falla la primera vez: el ADMIN ya confirmó, corrige otra cosa y
    // guarda de nuevo. Traducir otra vez sería pagar dos veces por el mismo
    // texto, y además podría dar un objeto distinto del que confirmó.
    let traducciones = 0;
    let posts = 0;
    server.use(
      mockBranches(),
      http.post(translateUrl, () => {
        traducciones += 1;
        return HttpResponse.json({ guardrails: { infoNoModificable: ["email"] }, descartado: [] });
      }),
      http.post(baseUrl, () => {
        posts += 1;
        if (posts === 1) {
          return HttpResponse.json({ error: { message: "Algo salió mal" } }, { status: 500 });
        }
        return HttpResponse.json(makeAgent(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/new");
    await completarMinimo(user);
    await escribirGuardrails(user, "No hables de política.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar y guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(traducciones).toBe(1);
    expect(posts).toBe(2);
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

  it("Instrucciones invita a escribir ahí los temas, las promesas y cuándo derivar (ítem 72)", async () => {
    server.use(mockBranches());
    renderForm("/agents/new");

    const hint = screen.getByText(/Es lo que el modelo lee antes de cada conversación/);
    expect(hint).toHaveTextContent(/temas que no puede tocar/);
    expect(hint).toHaveTextContent(/promesas que no puede hacer/);
    expect(hint).toHaveTextContent(/derivar la conversación a una persona/);
  });

  it("Reglas del agente habla solo de los tres candados de código, y dice que son código", async () => {
    server.use(mockBranches());
    renderForm("/agents/new");

    const hint = screen.getByText(/Escribilo con tus palabras/);
    expect(hint).toHaveTextContent(/acciones no puede ejecutar nunca/);
    expect(hint).toHaveTextContent(/datos no puede modificar/);
    expect(hint).toHaveTextContent(/antes de ejecutar una acción/);
    // La diferencia real con Instrucciones, dicha con todas las letras: es lo
    // único que justifica que esto viva en un campo aparte.
    expect(hint).toHaveTextContent(/el sistema verifica con código/);
    // Y lo otro no se pide acá: se dice dónde va.
    expect(hint).toHaveTextContent(/va en Instrucciones/);

    const placeholder =
      screen.getByLabelText("Reglas del agente").getAttribute("placeholder") ?? "";
    expect(placeholder).toMatch(/sin que un humano lo confirme/);
    expect(placeholder).toMatch(/No modifiques el email/);
    expect(placeholder).toMatch(/Antes de reservar un turno/);
    // Los ejemplos de las tres categorías que se fueron ya no están.
    expect(placeholder).not.toMatch(/diagnósticos médicos/);
    expect(placeholder).not.toMatch(/derivá/);
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

  it("hidrata los campos, con los guardrails en las palabras del ADMIN", async () => {
    server.use(
      mockBranches(),
      mockAgentDetalle({
        name: "Asistente de ventas",
        goal: "Calificar el lead",
        tone: "cercano",
        modelName: "openai/gpt-4o-mini",
        guardrails: { accionesProhibidas: ["update_opportunity"] },
        guardrailsText: "No modifiques oportunidades.",
      }),
    );

    renderForm("/agents/ag1/edit");

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Asistente de ventas");
    expect(screen.getByLabelText("Objetivo")).toHaveValue("Calificar el lead");
    expect(screen.getByLabelText("Tono")).toHaveValue("cercano");
    expect(screen.getByLabelText("Modelo")).toHaveValue("openai/gpt-4o-mini");
    // El texto, no el JSON: el JSON ya no se muestra en el formulario.
    expect(screen.getByLabelText("Reglas del agente")).toHaveValue("No modifiques oportunidades.");
  });

  it("guardar sin tocar el texto no traduce de nuevo y reenvía el guardrails existente", async () => {
    let traducciones = 0;
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      mockAgentDetalle({
        guardrails: { accionesProhibidas: ["update_opportunity"] },
        guardrailsText: "No modifiques oportunidades.",
      }),
      http.post(translateUrl, () => {
        traducciones += 1;
        return HttpResponse.json({ guardrails: {}, descartado: [] });
      }),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");

    const nombre = await screen.findByLabelText("Nombre");
    await user.clear(nombre);
    await user.type(nombre, "Otro nombre");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(traducciones).toBe(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bodies[0].guardrails).toEqual({ accionesProhibidas: ["update_opportunity"] });
    expect(bodies[0].guardrailsText).toBe("No modifiques oportunidades.");
  });

  it("cambiar el texto sí dispara la traducción, y el PATCH lleva lo confirmado", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      mockAgentDetalle({
        guardrails: { accionesProhibidas: ["update_opportunity"] },
        guardrailsText: "No modifiques oportunidades.",
      }),
      mockTranslate({ guardrails: { infoNoModificable: ["email"] } }),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");
    await screen.findByLabelText("Nombre");

    await escribirGuardrails(user, "No hables de política.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar y guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].guardrails).toEqual({ infoNoModificable: ["email"] });
    expect(bodies[0].guardrailsText).toBe("No hables de política.");
  });

  it("el panel muestra también lo heredado que esta pantalla ya no escribe (ítem 72)", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockBranches(),
      // Un agente de los de antes: tiene las tres claves que hoy van en
      // Instrucciones.
      mockAgentDetalle({
        guardrails: {
          accionesProhibidas: ["update_opportunity"],
          temasProhibidos: ["diagnósticos médicos"],
          condicionesDeDerivacion: ["reclamo o queja"],
        },
        guardrailsText: "El texto viejo, con todo mezclado.",
      }),
      mockTranslate({ guardrails: { infoNoModificable: ["email"] } }),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderForm("/agents/ag1/edit");
    await screen.findByLabelText("Nombre");

    await escribirGuardrails(user, "No toques el mail del contacto.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const panel = await screen.findByRole("dialog");
    // Lo que se acaba de traducir…
    expect(within(panel).getByText("No puede modificar estos datos: email.")).toBeInTheDocument();
    // …y lo que el agente sigue teniendo aunque desde acá ya no se edite. Si
    // el panel las escondiera, diría menos de lo que el agente hace cumplir.
    expect(within(panel).getByText("No habla de: diagnósticos médicos.")).toBeInTheDocument();
    expect(
      within(panel).getByText("Deriva a una persona si: reclamo o queja."),
    ).toBeInTheDocument();
    // La acción prohibida vieja NO sobrevive: esa clave sí la escribe esta
    // pantalla, y la traducción nueva no la trajo.
    expect(within(panel).queryByText(/No puede ejecutar estas acciones/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar y guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // El PATCH lleva solo lo traducido: preservar lo heredado es tarea del
    // backend (preservarGuardrailsHeredados), no de esta pantalla.
    expect(bodies[0].guardrails).toEqual({ infoNoModificable: ["email"] });
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
        // Los dos SIEMPRE juntos: el backend rechaza un PATCH con uno solo.
        guardrails: {},
        guardrailsText: "",
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
