import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAutomation } from "../../test/automationFixtures";
import { listSelectOptions } from "../../test/chooseSelectOption";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AutomationFormPage } from "./AutomationFormPage";

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

const baseUrl = `${env.apiUrl}/api/automations`;

// Se renderiza dentro de un Routes real para que useParams vea (o no vea) el
// :id — es lo único que distingue el modo creación del de edición.
function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/automations/new" element={<AutomationFormPage />} />
          <Route path="/automations/:id/edit" element={<AutomationFormPage />} />
          <Route path="/automations" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Los dos campos de la config de activity.create_follow_up, que es la única
// acción del catálogo de hoy.
async function completarSeguimiento(
  user: ReturnType<typeof userEvent.setup>,
  subject: string,
  dias: string,
) {
  await user.type(screen.getByLabelText("Título de la tarea"), subject);
  const campoDias = screen.getByLabelText("Vence en (días)");
  await user.clear(campoDias);
  await user.type(campoDias, dias);
}

describe("AutomationFormPage — creación", () => {
  it("el evento y la acción son <Select> de verdad, con la única opción del catálogo ya elegida", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");

    // Vienen preseleccionados —hay una sola opción de cada uno—, pero son
    // selectores y no un campo fijo: sumar el segundo trigger el día de mañana
    // es agregar una entrada a catalog.ts y nada más.
    expect(screen.getByLabelText("Evento")).toHaveValue("Oportunidad ganada");
    expect(screen.getByLabelText("Acción")).toHaveValue("Crear actividad de seguimiento");

    expect(await listSelectOptions(user, screen.getByLabelText("Evento"))).toEqual([
      "Oportunidad ganada",
    ]);
  });

  it("los campos de configuración son los de la acción elegida", () => {
    renderForm("/automations/new");

    // subject + daysUntilDue + notes: los tres campos de
    // configDeSeguimientoSchema, y ninguno más. Otra acción traería otro
    // bloque.
    expect(screen.getByLabelText("Título de la tarea")).toBeInTheDocument();
    expect(screen.getByLabelText("Vence en (días)")).toBeInTheDocument();
    expect(screen.getByLabelText("Notas")).toBeInTheDocument();
  });

  it("manda el POST con la regla completa y vuelve al listado", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Seguimiento post-venta");
    await completarSeguimiento(user, "Llamar para coordinar la entrega", "3");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: "Seguimiento post-venta",
        triggerType: "opportunity.won",
        actionType: "activity.create_follow_up",
        // daysUntilDue viaja como NÚMERO, no como el string del input: el
        // schema del backend lo pide entero y un "3" sería un 400. Y `notes`
        // NO está: no se cargó ninguna nota, y el backend rechaza el "".
        actionConfig: { subject: "Llamar para coordinar la entrega", daysUntilDue: 3 },
        isActive: true,
      },
    ]);
  });

  it("se puede guardar sin llenar las Notas: son opcionales y la clave no viaja", async () => {
    // El campo está vacío y el submit pasa igual: si `required` se hubiera
    // colado, el <form> nativo lo habría frenado y no habría POST.
    const bodies: { actionConfig?: Record<string, unknown> }[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { actionConfig?: Record<string, unknown> });
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Sin notas");
    await completarSeguimiento(user, "Llamar", "3");
    expect(screen.getByLabelText("Notas")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies[0]?.actionConfig).toEqual({ subject: "Llamar", daysUntilDue: 3 });
  });

  it("lo que se escribe en Notas viaja en el actionConfig del POST", async () => {
    const bodies: { actionConfig?: Record<string, unknown> }[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { actionConfig?: Record<string, unknown> });
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Con notas");
    await completarSeguimiento(user, "Llamar", "3");
    await user.type(screen.getByLabelText("Notas"), "Preguntar por la patente definitiva");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies[0]?.actionConfig).toEqual({
      subject: "Llamar",
      daysUntilDue: 3,
      notes: "Preguntar por la patente definitiva",
    });
  });

  it("guardar como inactiva: se manda isActive false", async () => {
    const bodies: { isActive?: boolean }[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { isActive?: boolean });
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Pausada de entrada");
    await completarSeguimiento(user, "Llamar", "0");
    await user.click(screen.getByLabelText("Activa"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies[0]?.isActive).toBe(false));
  });

  it("0 días es válido: la tarea vence el mismo día", async () => {
    const bodies: { actionConfig?: { daysUntilDue?: number } }[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push((await request.json()) as { actionConfig?: { daysUntilDue?: number } });
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Llamar el mismo día");
    await completarSeguimiento(user, "Llamar hoy", "0");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // 0 no es "vacío": un `if (!dias)` lo habría rechazado.
    await waitFor(() => expect(bodies[0]?.actionConfig?.daysUntilDue).toBe(0));
  });

  it("un valor fuera del rango 0-365 no sale del formulario: el backend no se entera", async () => {
    let llamadas = 0;
    server.use(
      http.post(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Demasiado lejos");
    await completarSeguimiento(user, "Llamar", "400");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // El rango se frena en la pantalla y no se depende del 400 del backend.
    // QUIÉN lo frena en este camino es el `max` del propio input: la
    // validación nativa corre ANTES del submit, así que no llega a verse el
    // mensaje de validar(). Ese es el backstop de la acción y está probado
    // por su cuenta en catalog.test.ts — acá lo que importa es que el
    // request no salió.
    expect(screen.getByLabelText("Vence en (días)")).toHaveAttribute("max", "365");
    expect(screen.getByLabelText("Vence en (días)")).toHaveAttribute("min", "0");
    expect(llamadas).toBe(0);
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });

  it("Nombre y los campos de la config son requeridos, y llevan los topes del backend", () => {
    renderForm("/automations/new");

    const nombre = screen.getByLabelText("Nombre");
    expect(nombre).toBeRequired();
    expect(nombre).toHaveAttribute("maxLength", "200");

    const subject = screen.getByLabelText("Título de la tarea");
    expect(subject).toBeRequired();
    expect(subject).toHaveAttribute("maxLength", "200");

    expect(screen.getByLabelText("Vence en (días)")).toBeRequired();

    // Notas es el único OPCIONAL de la config: sin `required` y sin el
    // asterisco de .ds-required, mismo trato que el "Notas" del formulario
    // manual de actividades. Lleva el tope del backend como maxLength —igual
    // que el título—, que es comodidad y no la garantía.
    const notas = screen.getByLabelText("Notas");
    expect(notas).not.toBeRequired();
    expect(notas).toHaveAttribute("maxLength", "5000");
  });

  it("un POST fallido muestra el mensaje del backend, NO navega y NO pierde lo escrito", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          {
            error: {
              message:
                'actionConfig inválido para "activity.create_follow_up": subject es requerido',
            },
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Seguimiento post-venta");
    await completarSeguimiento(user, "Llamar para coordinar la entrega", "3");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("subject es requerido");
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
    // Lo que el ADMIN ya tenía escrito sigue ahí: un 400 no le cuesta el
    // formulario.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Seguimiento post-venta");
    expect(screen.getByLabelText("Título de la tarea")).toHaveValue(
      "Llamar para coordinar la entrega",
    );
    expect(screen.getByLabelText("Vence en (días)")).toHaveValue(3);
  });
});

describe("AutomationFormPage — edición", () => {
  it("hidrata la regla entera con lo que devuelve el GET, config incluida", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeAutomation({
            name: "Seguimiento a la semana",
            actionConfig: {
              subject: "Preguntar cómo salió todo",
              daysUntilDue: 7,
              notes: "Repasar qué se le prometió en la entrega",
            },
          }),
        ),
      ),
    );

    renderForm("/automations/au1/edit");

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Seguimiento a la semana");
    expect(screen.getByLabelText("Evento")).toHaveValue("Oportunidad ganada");
    expect(screen.getByLabelText("Acción")).toHaveValue("Crear actividad de seguimiento");
    // El actionConfig llega como JSON y se abre en los campos de la acción:
    // el número entra al input como texto y vuelve a salir como número.
    expect(screen.getByLabelText("Título de la tarea")).toHaveValue("Preguntar cómo salió todo");
    expect(screen.getByLabelText("Vence en (días)")).toHaveValue(7);
    expect(screen.getByLabelText("Notas")).toHaveValue("Repasar qué se le prometió en la entrega");
    expect(screen.getByLabelText("Activa")).toBeChecked();
  });

  it("manda el PATCH con la regla completa, no con un diff", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeAutomation())),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation());
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    const nombre = await screen.findByLabelText("Nombre");
    await user.clear(nombre);
    await user.type(nombre, "Seguimiento renombrado");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    // Los cuatro campos juntos: el service revalida el actionConfig EFECTIVO
    // contra la acción EFECTIVA, así que mandar el actionType sin su config lo
    // obligaría a revalidar la config vieja contra el schema nuevo.
    expect(bodies).toEqual([
      {
        name: "Seguimiento renombrado",
        triggerType: "opportunity.won",
        actionType: "activity.create_follow_up",
        actionConfig: { subject: "Llamar para coordinar la entrega", daysUntilDue: 3 },
        isActive: true,
      },
    ]);
  });

  it('borrar las Notas de una regla que las tenía saca la clave del PATCH, no manda ""', async () => {
    // El único camino por el que una regla vuelve a "sin notas". Mandar "" en
    // su lugar sería un 400 del backend, que rechaza el string vacío.
    const bodies: { actionConfig?: Record<string, unknown> }[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeAutomation({
            actionConfig: { subject: "Llamar", daysUntilDue: 3, notes: "Algo que ya no aplica" },
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as { actionConfig?: Record<string, unknown> });
        return HttpResponse.json(makeAutomation());
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    await user.clear(await screen.findByLabelText("Notas"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.actionConfig).toEqual({ subject: "Llamar", daysUntilDue: 3 });
  });

  it("desactivar una regla activa manda isActive false y no la borra", async () => {
    const bodies: { isActive?: boolean }[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeAutomation({ isActive: true }))),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as { isActive?: boolean });
        return HttpResponse.json(makeAutomation({ isActive: false }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    await user.click(await screen.findByLabelText("Activa"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies[0]?.isActive).toBe(false));
  });

  it("volver a activar una regla pausada manda isActive true", async () => {
    const bodies: { isActive?: boolean }[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeAutomation({ isActive: false }))),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push((await request.json()) as { isActive?: boolean });
        return HttpResponse.json(makeAutomation({ isActive: true }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    const activa = await screen.findByLabelText("Activa");
    expect(activa).not.toBeChecked();
    await user.click(activa);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies[0]?.isActive).toBe(true));
  });

  it("una acción que este catálogo todavía no conoce se puede ABRIR, pero no guardar a ciegas", async () => {
    // El backend suma una acción y el frontend desplegado todavía no la tiene.
    // La regla se abre —el valor guardado entra como una opción más del
    // selector, igual que la zona horaria legacy del ítem 26— y el guardado se
    // frena con un mensaje en vez de mandar una config a medias.
    let llamadas = 0;
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeAutomation({
            actionType: "whatsapp.send_message",
            actionConfig: { template: "recordatorio" },
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, () => {
        llamadas += 1;
        return HttpResponse.json(makeAutomation());
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    expect(await screen.findByLabelText("Acción")).toHaveValue("whatsapp.send_message");
    expect(screen.queryByLabelText("Título de la tarea")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notas")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'La acción "whatsapp.send_message" no se puede configurar desde esta pantalla todavía.',
    );
    expect(llamadas).toBe(0);
  });

  it("estado de carga mientras se pide la regla", () => {
    server.use(http.get(`${baseUrl}/:id`, () => new Promise(() => undefined)));
    renderForm("/automations/au1/edit");
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("estado de error, con el mensaje real del backend", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Automatización no encontrada" } }, { status: 404 }),
      ),
    );
    renderForm("/automations/au1/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Automatización no encontrada");
  });
});

// Misma jerarquía real que app/router.tsx, con el destino del redirect
// reemplazado por un placeholder — mismo criterio que
// KnowledgeBaseFormPage.test.tsx.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/automations/new" element={<AutomationFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AutomationFormPage — bajo AdminRoute", () => {
  it("un USER entrando a /automations/new es redirigido", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderUnderAdminRoute("/automations/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Nueva automatización" })).not.toBeInTheDocument();
  });

  it("un ADMIN sí ve el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderUnderAdminRoute("/automations/new");

    expect(
      await screen.findByRole("heading", { name: "Nueva automatización" }),
    ).toBeInTheDocument();
  });
});
