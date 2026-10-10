import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAutomation } from "../../test/automationFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { makeQrCode } from "../../test/qrFixtures";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AutomationFormPage } from "./AutomationFormPage";
import { textoInicial } from "./catalog";
import type { WhatsappApproval } from "./types";
import { edicionDeMe } from "../../test/edicionFixtures";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// La pantalla lee `me` solo por la edición (los rótulos de ESENCIAL,
// docs/ediciones.md §8); por defecto, un ADMIN sin datos de edición, que ve lo
// de siempre. Los casos de AdminRoute del final fijan el rol.
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
      canUseInternalAgent: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth("ADMIN"));
});

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
  it("el evento y la acción son <Select> de verdad, con la primera opción del catálogo ya elegida", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");

    expect(screen.getByLabelText("Evento")).toHaveValue("Oportunidad ganada");
    expect(screen.getByLabelText("Acción")).toHaveValue("Crear actividad de seguimiento");

    expect(await listSelectOptions(user, screen.getByLabelText("Evento"))).toEqual([
      "Oportunidad ganada",
      "Oportunidad sin movimiento",
      "Consulta sin avance",
    ]);
  });

  it("con Oportunidad ganada, la acción ofrece la tarea de seguimiento, el QR o el cupón por WhatsApp, y el evento no pide campos", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");

    expect(await listSelectOptions(user, screen.getByLabelText("Acción"))).toEqual([
      "Crear actividad de seguimiento",
      "Enviar QR por WhatsApp",
      "Enviar cupón de descuento",
    ]);
    expect(screen.queryByLabelText("Días sin movimiento")).not.toBeInTheDocument();
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
        // Oportunidad ganada no tiene config: viaja "{}", que es lo que el
        // backend guarda para ese evento.
        triggerConfig: {},
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

describe("AutomationFormPage — Oportunidad sin movimiento + borrador con IA (ítem 76)", () => {
  it("elegir el evento pide los días sin movimiento y pasa la acción a Redactar seguimiento con IA", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");

    // Antes: los campos de la tarea de seguimiento.
    expect(screen.getByLabelText("Título de la tarea")).toBeInTheDocument();

    await chooseSelectOption(user, screen.getByLabelText("Evento"), "Oportunidad sin movimiento");

    const dias = screen.getByLabelText("Días sin movimiento");
    expect(dias).toBeRequired();
    expect(dias).toHaveAttribute("min", "0");
    expect(dias).toHaveAttribute("max", "365");

    // La acción que el evento admite, sola en el selector, y sin campos
    // propios: los de la tarea de seguimiento desaparecen.
    expect(screen.getByLabelText("Acción")).toHaveValue("Redactar seguimiento con IA");
    expect(await listSelectOptions(user, screen.getByLabelText("Acción"))).toEqual([
      "Redactar seguimiento con IA",
    ]);
    expect(screen.queryByLabelText("Título de la tarea")).not.toBeInTheDocument();
    expect(screen.getByText(/lo revisa y envía el vendedor/)).toBeInTheDocument();
  });

  it("manda el POST con triggerConfig { daysWithoutActivity } como número y actionConfig vacío", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Seguimiento de estancadas");
    await chooseSelectOption(user, screen.getByLabelText("Evento"), "Oportunidad sin movimiento");
    await user.type(screen.getByLabelText("Días sin movimiento"), "7");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: "Seguimiento de estancadas",
        triggerType: "opportunity.stale",
        triggerConfig: { daysWithoutActivity: 7 },
        actionType: "agent.draft_follow_up",
        actionConfig: {},
        isActive: true,
      },
    ]);
  });

  it("sin los días no sale del formulario, y 0 es válido", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Estancadas");
    await chooseSelectOption(user, screen.getByLabelText("Evento"), "Oportunidad sin movimiento");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    // El required nativo frena el submit: no hubo POST.
    expect(bodies).toEqual([]);

    await user.type(screen.getByLabelText("Días sin movimiento"), "0");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toHaveLength(1);
    expect((bodies[0] as { triggerConfig: unknown }).triggerConfig).toEqual({
      daysWithoutActivity: 0,
    });
  });

  it("volver a Oportunidad ganada vuelve a la tarea de seguimiento y el evento deja de pedir días", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");

    await chooseSelectOption(user, screen.getByLabelText("Evento"), "Oportunidad sin movimiento");
    await chooseSelectOption(user, screen.getByLabelText("Evento"), "Oportunidad ganada");

    expect(screen.queryByLabelText("Días sin movimiento")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Acción")).toHaveValue("Crear actividad de seguimiento");
    expect(screen.getByLabelText("Título de la tarea")).toHaveValue("");
  });

  it("edición: hidrata los días guardados y el PATCH los manda de vuelta con la regla completa", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          makeAutomation({
            name: "Estancadas",
            triggerType: "opportunity.stale",
            triggerConfig: { daysWithoutActivity: 10 },
            actionType: "agent.draft_follow_up",
            actionConfig: {},
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation());
      }),
    );

    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    const dias = await screen.findByLabelText("Días sin movimiento");
    expect(dias).toHaveValue(10);
    expect(screen.getByLabelText("Evento")).toHaveValue("Oportunidad sin movimiento");
    expect(screen.getByLabelText("Acción")).toHaveValue("Redactar seguimiento con IA");

    await user.clear(dias);
    await user.type(dias, "14");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: "Estancadas",
        triggerType: "opportunity.stale",
        triggerConfig: { daysWithoutActivity: 14 },
        actionType: "agent.draft_follow_up",
        actionConfig: {},
        isActive: true,
      },
    ]);
  });
});

describe("AutomationFormPage — Oportunidad ganada + QR por WhatsApp (ítem 159)", () => {
  const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

  // El selector lista los QR activos de la organización y usa las sucursales
  // para el subtítulo.
  function servirQrsYSucursales() {
    server.use(
      http.get(`${env.apiUrl}/api/qr`, () =>
        HttpResponse.json({
          data: [
            makeQrCode({ id: QR_ID, displayNumber: 1, name: "Reseñas Google", branchId: "b1" }),
            makeQrCode({
              id: "e0000000-0000-4000-8000-000000000002",
              displayNumber: 2,
              name: "Linktree",
              branchId: "b1",
              destinationUrl: "https://linktr.ee/agencia",
            }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [makeBranch({ id: "b1", name: "Centro" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
  }

  it("elegir la acción pide el QR y la espera con su unidad (horas por defecto)", async () => {
    servirQrsYSucursales();
    const user = userEvent.setup();
    renderForm("/automations/new");

    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar QR por WhatsApp");

    expect(screen.queryByLabelText("Título de la tarea")).not.toBeInTheDocument();
    const qr = await screen.findByLabelText("QR a enviar");
    expect(qr).toBeRequired();
    expect(await listSelectOptions(user, qr)).toEqual([
      "Elegir QR…",
      "QR 1 · Reseñas Google",
      "QR 2 · Linktree",
    ]);
    const espera = screen.getByLabelText("Esperar");
    expect(espera).toBeRequired();
    expect(espera).toHaveAttribute("min", "0");
    const unidad = screen.getByLabelText("Unidad");
    expect(unidad).toHaveValue("Horas");
    expect(await listSelectOptions(user, unidad)).toEqual(["Minutos", "Horas", "Días"]);
    expect(screen.getByText(/hasta 30 días de espera/)).toBeInTheDocument();
  });

  it("sin ningún QR, avisa dónde crearlo en vez de un desplegable vacío", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/qr`, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm("/automations/new");

    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar QR por WhatsApp");

    expect(await screen.findByText(/Todavía no hay QR./)).toHaveTextContent(
      "Todavía no hay QR. Creá uno en la pestaña QR.",
    );
    expect(screen.getByRole("link", { name: "pestaña QR" })).toHaveAttribute("href", "/qr");
    expect(screen.queryByRole("combobox", { name: "QR a enviar" })).not.toBeInTheDocument();
  });

  it("manda el POST con { qrCodeId, delayMinutes }: 15 minutos, menos de una hora", async () => {
    servirQrsYSucursales();
    const bodies: unknown[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Pedir reseña");
    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar QR por WhatsApp");
    await chooseSelectOption(
      user,
      await screen.findByLabelText("QR a enviar"),
      "QR 1 · Reseñas Google",
    );
    await user.type(screen.getByLabelText("Esperar"), "15");
    await chooseSelectOption(user, screen.getByLabelText("Unidad"), "Minutos");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: "Pedir reseña",
        triggerType: "opportunity.won",
        triggerConfig: {},
        actionType: "opportunity.send_qr_followup",
        // El mensaje viaja con la regla: formato y texto (el inicial, si no se
        // tocó). La plantilla de Meta la arma el backend.
        actionConfig: {
          qrCodeId: QR_ID,
          delayMinutes: 15,
          whatsappFormat: "LINK",
          messageText: textoInicial("opportunity.send_qr_followup", "LINK"),
        },
        isActive: true,
      },
    ]);
  });

  it("edición de una regla vieja: sus 24 horas se muestran como 1 día", async () => {
    servirQrsYSucursales();
    server.use(
      http.get(`${baseUrl}/a1`, () =>
        HttpResponse.json(
          makeAutomation({
            id: "a1",
            actionType: "opportunity.send_qr_followup",
            actionConfig: { qrCodeId: QR_ID, delayHours: 24 },
          }),
        ),
      ),
    );
    renderForm("/automations/a1/edit");

    expect(await screen.findByLabelText("Esperar")).toHaveValue(1);
    expect(screen.getByLabelText("Unidad")).toHaveValue("Días");
    await waitFor(() =>
      expect(screen.getByLabelText("QR a enviar")).toHaveValue("QR 1 · Reseñas Google"),
    );
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
        triggerConfig: {},
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

// ---------------------------------------------------------------------------
// El mensaje de WhatsApp en la regla: formato, texto, vista previa y el único
// estado de aprobación. La plantilla de Meta no se ve.
// ---------------------------------------------------------------------------

describe("AutomationFormPage — mensaje de WhatsApp y aprobación", () => {
  const QR = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
  const TEXTO_APROBADO = "Hola {nombre}, gracias. Tu opinión: {link} ¡Gracias!";

  function aprobacion(extra: Partial<WhatsappApproval> = {}): WhatsappApproval {
    return {
      estado: "APROBADA",
      motivo: null,
      mandaLaAnterior: false,
      bodyText: TEXTO_APROBADO,
      formato: "LINK",
      ...extra,
    };
  }

  function servirRegla(whatsappApproval: WhatsappApproval, actionConfig = {}) {
    server.use(
      http.get(`${env.apiUrl}/api/qr`, () =>
        HttpResponse.json({
          data: [makeQrCode({ id: QR, displayNumber: 1, name: "Reseñas Google", branchId: "b1" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [makeBranch({ id: "b1", name: "Centro" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${baseUrl}/a1`, () =>
        HttpResponse.json({
          ...makeAutomation({
            id: "a1",
            actionType: "opportunity.send_qr_followup",
            actionConfig: { qrCodeId: QR, delayHours: 24, ...actionConfig },
          }),
          whatsappApproval,
        }),
      ),
    );
  }

  it("una regla vieja abre con el texto aprobado y 'solo link', y guardarla manda lo mismo", async () => {
    servirRegla(aprobacion());
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${baseUrl}/a1`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ...makeAutomation({ id: "a1" }),
          whatsappApproval: aprobacion(),
        });
      }),
    );
    const user = userEvent.setup();
    renderForm("/automations/a1/edit");

    expect(await screen.findByLabelText("Texto del mensaje")).toHaveValue(TEXTO_APROBADO);
    expect(screen.getByRole("radio", { name: "Solo link" })).toBeChecked();
    expect(screen.getByText(/Aprobación de WhatsApp:/)).toHaveTextContent(
      "Aprobación de WhatsApp: Aprobada",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("QR a enviar")).toHaveValue("QR 1 · Reseñas Google"),
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect((bodies[0] as { actionConfig: unknown }).actionConfig).toEqual({
      qrCodeId: QR,
      // La regla vieja tenía delayHours: 24; se guarda ya en minutos.
      delayMinutes: 1440,
      whatsappFormat: "LINK",
      messageText: TEXTO_APROBADO,
    });
  });

  it("pendiente con la versión anterior en uso: lo dice, y 'Consultar estado' le pregunta a Meta", async () => {
    servirRegla(aprobacion({ estado: "PENDIENTE", mandaLaAnterior: true, formato: "IMAGE" }));
    let consultas = 0;
    server.use(
      http.post(`${baseUrl}/a1/whatsapp-approval/refresh`, () => {
        consultas++;
        return HttpResponse.json(aprobacion());
      }),
    );
    const user = userEvent.setup();
    renderForm("/automations/a1/edit");

    expect(await screen.findByText(/Aprobación de WhatsApp:/)).toHaveTextContent("Pendiente");
    expect(screen.getByText(/se sigue mandando el anterior/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Consultar estado" }));
    await waitFor(() => expect(consultas).toBe(1));
  });

  it("rechazada: el motivo de Meta entre paréntesis y qué hacer", async () => {
    servirRegla(aprobacion({ estado: "RECHAZADA", motivo: "INVALID_FORMAT" }));
    renderForm("/automations/a1/edit");

    expect(await screen.findByText(/Aprobación de WhatsApp:/)).toHaveTextContent(
      "Aprobación de WhatsApp: Rechazada (INVALID_FORMAT)",
    );
    expect(screen.getByText(/Cambiá el texto y guardá/)).toBeInTheDocument();
  });

  it("regla nueva: explica que se manda a aprobar al guardar; 'solo imagen' cambia el texto inicial y la vista previa", async () => {
    const user = userEvent.setup();
    renderForm("/automations/new");
    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar QR por WhatsApp");

    expect(screen.getByText(/se manda a aprobar a WhatsApp/)).toBeInTheDocument();
    expect(screen.getByLabelText("Texto del mensaje")).toHaveValue(
      textoInicial("opportunity.send_qr_followup", "LINK"),
    );
    expect(screen.getByRole("button", { name: "Insertar {link}" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Solo imagen" }));

    expect(screen.getByLabelText("Texto del mensaje")).toHaveValue(
      textoInicial("opportunity.send_qr_followup", "IMAGE"),
    );
    expect(screen.queryByRole("button", { name: "Insertar {link}" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Vista previa del mensaje")).toHaveTextContent("Imagen del QR");
    expect(screen.getByLabelText("Vista previa del mensaje")).toHaveTextContent("Hola Ana,");
  });

  it("cupón de descuento: sus campos y el POST con el mensaje", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [makeBranch({ id: QR, name: "Centro" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const bodies: unknown[] = [];
    server.use(
      http.post(baseUrl, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/automations/new");

    await user.type(screen.getByLabelText("Nombre"), "Cupón post-venta");
    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar cupón de descuento");
    await user.type(screen.getByLabelText("Descuento"), "15% en el taller");
    await chooseSelectOption(user, await screen.findByLabelText("Sucursal"), "Centro");
    await user.type(screen.getByLabelText("Esperar"), "2");
    await user.type(screen.getByLabelText("Vence a los (días)"), "30");
    await user.click(screen.getByRole("radio", { name: "Imagen y link" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("listado")).toBeInTheDocument());
    expect((bodies[0] as { actionConfig: unknown }).actionConfig).toEqual({
      label: "15% en el taller",
      branchId: QR,
      delayMinutes: 120,
      expiresInDays: 30,
      whatsappFormat: "LINK_AND_IMAGE",
      messageText: textoInicial("opportunity.send_discount_voucher", "LINK_AND_IMAGE"),
    });
  });

  it("si el mensaje no llegó a Meta, la regla se guardó: queda en la pantalla con el motivo", async () => {
    servirRegla(aprobacion());
    server.use(
      http.patch(`${baseUrl}/a1`, () =>
        HttpResponse.json({
          ...makeAutomation({ id: "a1" }),
          whatsappApproval: aprobacion(),
          whatsappSyncError: "No se pudo contactar a WhatsApp. Probá de nuevo en unos minutos.",
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm("/automations/a1/edit");
    await screen.findByLabelText("Texto del mensaje");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(/La regla se guardó, pero el mensaje no se pudo mandar/),
    ).toBeInTheDocument();
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });

  it("un alta cuyo mensaje no llegó a Meta pasa a la edición de la regla creada, con el motivo", async () => {
    servirRegla(aprobacion({ estado: "SIN_PLANTILLA", bodyText: null, formato: null }));
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          {
            ...makeAutomation({ id: "a1" }),
            whatsappApproval: aprobacion({ estado: "SIN_PLANTILLA" }),
            whatsappSyncError: "Meta rechazó el pedido.",
          },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/automations/new");
    await user.type(screen.getByLabelText("Nombre"), "Pedir reseña");
    await chooseSelectOption(user, screen.getByLabelText("Acción"), "Enviar QR por WhatsApp");
    await chooseSelectOption(
      user,
      await screen.findByLabelText("QR a enviar"),
      "QR 1 · Reseñas Google",
    );
    await user.type(screen.getByLabelText("Esperar"), "1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/Meta rechazó el pedido/)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Editar automatización" }),
    ).toBeInTheDocument();
  });
});

// Ediciones (docs/ediciones.md §8): el mismo catálogo; en ESENCIAL la venta se
// nombra "Venta registrada".
describe("AutomationFormPage — por edición", () => {
  function conEdicion(edition: "COMPLETA" | "ESENCIAL") {
    const base = mockAuth("ADMIN");
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...edicionDeMe(edition) } });
  }

  it("ESENCIAL: el evento de la venta es «Venta registrada», con los mismos tres eventos", async () => {
    conEdicion("ESENCIAL");
    const user = userEvent.setup();
    renderForm("/automations/new");
    expect(screen.getByLabelText("Evento")).toHaveValue("Venta registrada");
    expect(await listSelectOptions(user, screen.getByLabelText("Evento"))).toEqual([
      "Venta registrada",
      "Oportunidad sin movimiento",
      "Consulta sin avance",
    ]);
  });

  it("COMPLETA: «Oportunidad ganada», como siempre", async () => {
    conEdicion("COMPLETA");
    renderForm("/automations/new");
    expect(screen.getByLabelText("Evento")).toHaveValue("Oportunidad ganada");
  });
});

// R15 (docs/rubros.md §9.1): en una clínica, el seguimiento de consultas lleva
// {prestacion} en lugar de {vehiculo}.
describe("AutomationFormPage — seguimiento de consultas en una clínica", () => {
  function reglaDeConsultas(messageText: string) {
    return http.get(`${baseUrl}/:id`, () =>
      HttpResponse.json(
        makeAutomation({
          name: "Consultas",
          triggerType: "contact.inquiry_stalled",
          triggerConfig: { daysSinceLastMessage: 3, maxFollowUps: 1 },
          actionType: "inquiry.follow_up",
          actionConfig: { messageText },
        }),
      ),
    );
  }

  it("una clínica ofrece {prestacion} y guarda su texto", async () => {
    const base = mockAuth("ADMIN");
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, industry: "CLINICA" } });
    const bodies: unknown[] = [];
    server.use(
      reglaDeConsultas(
        "¡{saludo}! Te escribimos por tu consulta sobre {prestacion}. ¿Te ayudamos?",
      ),
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeAutomation());
      }),
    );
    const user = userEvent.setup();
    renderForm("/automations/au1/edit");

    expect(
      await screen.findByRole("button", { name: "Insertar {prestacion}" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insertar {vehiculo}" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
  });

  it("una automotora sigue con {vehiculo}", async () => {
    server.use(
      reglaDeConsultas("¡{saludo}! Te escribimos por tu consulta sobre {vehiculo}. ¿Seguís?"),
    );
    renderForm("/automations/au1/edit");
    expect(await screen.findByRole("button", { name: "Insertar {vehiculo}" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insertar {prestacion}" })).not.toBeInTheDocument();
  });
});
