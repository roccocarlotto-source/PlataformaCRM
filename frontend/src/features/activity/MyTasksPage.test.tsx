import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { MyTasksPage } from "./MyTasksPage";
import { activityKeys } from "./queries";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { Activity, UpdateActivityInput } from "./types";

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

const activitiesUrl = `${env.apiUrl}/api/activities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const contactsUrl = `${env.apiUrl}/api/contacts`;
const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const usersUrl = `${env.apiUrl}/api/users`;

// Fechas RELATIVAS al reloj real (la página fija `now` al montar): una
// vencida hace una hora, una de hoy al final del día, una dentro de dos
// semanas (siempre "Más adelante", sea el día que sea) y una sin fecha.
// "Esta semana" se prueba aparte porque depende del día de la semana en que
// corra el test (un domingo no existe, ver taskBuckets.ts).
const NOW = new Date();
const overdue = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const todayLate = new Date(
  NOW.getFullYear(),
  NOW.getMonth(),
  NOW.getDate(),
  23,
  59,
  59,
).toISOString();
const inTwoWeeks = new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

const SAMPLE: Activity[] = [
  makeActivity({ id: "t-overdue", subject: "Llamar a Andrés", dueDate: overdue, type: "CALL" }),
  makeActivity({
    id: "t-today",
    subject: "Demo del plan Pro",
    dueDate: todayLate,
    type: "MEETING",
    companyId: "co1",
    contactId: "ct1",
    opportunityId: "op1",
  }),
  makeActivity({
    id: "t-later",
    subject: "Revisión trimestral",
    dueDate: inTwoWeeks,
    type: "TASK",
    companyId: null,
    contactId: "ct1",
  }),
  makeActivity({ id: "t-nodate", subject: "Depurar duplicados", dueDate: null, type: "TASK" }),
];

interface Captured {
  listRequests: URL[];
  patches: { id: string; body: UpdateActivityInput }[];
  // El "estado del server": el PATCH lo modifica y el listado lo lee, así
  // que un refetch refleja lo que se escribió, y un test puede simular lo
  // que hace un ADMIN desde otra pantalla (confirmar) tocándolo a mano.
  state: Activity[];
}

function tasksHandlers(
  activities: Activity[],
  options: { pageSize?: number; patchStatus?: number; autoConfirm?: boolean } = {},
): { handlers: ReturnType<typeof http.get>[]; captured: Captured } {
  const captured: Captured = {
    listRequests: [],
    patches: [],
    state: activities.map((a) => ({ ...a })),
  };
  const pageSize = options.pageSize ?? 100;
  const handlers = [
    http.get(activitiesUrl, ({ request }) => {
      const url = new URL(request.url);
      captured.listRequests.push(url);
      const page = Number(url.searchParams.get("page") ?? "1");
      // Mismo filtro que el backend real: confirmed=false deja afuera lo
      // confirmado (§29); completed=false, lo completado.
      const rows = captured.state.filter(
        (a) =>
          (url.searchParams.get("confirmed") !== "false" || a.confirmedAt === null) &&
          (url.searchParams.get("completed") !== "false" || a.completedAt === null),
      );
      return HttpResponse.json({
        data: rows.slice((page - 1) * pageSize, page * pageSize),
        pagination: {
          page,
          pageSize,
          total: rows.length,
          totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
        },
      });
    }),
    http.patch(`${activitiesUrl}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as UpdateActivityInput;
      captured.patches.push({ id: params.id as string, body });
      if (options.patchStatus && options.patchStatus >= 400) {
        return HttpResponse.json(
          { error: { message: "No tenés permisos para realizar esta acción" } },
          { status: options.patchStatus },
        );
      }
      const original = captured.state.find((a) => a.id === params.id) ?? makeActivity();
      // autoConfirm simula lo que el backend hace cuando quien tilda es
      // ADMIN (§29): la devuelve ya confirmada.
      const saved: Activity = {
        ...original,
        ...body,
        ...(options.autoConfirm && body.completedAt
          ? { confirmedAt: body.completedAt, confirmedById: "u1" }
          : {}),
      };
      captured.state = captured.state.map((a) => (a.id === saved.id ? saved : a));
      return HttpResponse.json(saved);
    }),
    http.get(`${companiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeCompany({ id: params.id as string, name: "Motor Delta" })),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: params.id as string, firstName: "Ana", lastName: "Pérez" }),
      ),
    ),
    http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeOpportunity({ id: params.id as string, title: "Plan Pro anual" })),
    ),
  ];
  return { handlers, captured };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function group(name: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

describe("MyTasksPage", () => {
  it("(a) pide SOLO las no confirmadas asignadas a mí y las agrupa por vencimiento en orden, ocultando los bloques vacíos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Depurar duplicados")).toBeInTheDocument());

    const request = captured.listRequests[0];
    expect(request?.searchParams.get("assigneeId")).toBe("u1");
    // §29: confirmed=false (pendientes + completadas sin confirmar), ya no
    // completed=false.
    expect(request?.searchParams.get("confirmed")).toBe("false");
    expect(request?.searchParams.has("completed")).toBe(false);
    expect(request?.searchParams.get("pageSize")).toBe("100");
    expect(request?.searchParams.get("sortBy")).toBe("dueDate");

    // Solo los encabezados de los grupos (el <h2> que nombra cada region), no
    // todos los <h2> de la página: la fila de filtros también tiene el suyo.
    const headings = screen
      .getAllByRole("region")
      .map((region) => within(region).getByRole("heading", { level: 2 }).textContent);
    // "Esta semana" no tiene tareas en la muestra → no se renderiza.
    expect(headings).toEqual(["Vencidas1", "Hoy1", "Más adelante1", "Sin fecha1"]);

    expect(within(group("Vencidas")).getByText("Llamar a Andrés")).toBeInTheDocument();
    expect(within(group("Hoy")).getByText("Demo del plan Pro")).toBeInTheDocument();
    expect(within(group("Más adelante")).getByText("Revisión trimestral")).toBeInTheDocument();
    const noDateRow = within(group("Sin fecha"))
      .getByText("Depurar duplicados")
      .closest("li") as HTMLElement;
    expect(within(noDateRow).getByText("Sin fecha")).toBeInTheDocument();

    // Relacionados con nombres reales: Empresa · Contacto · TÍTULO de la
    // oportunidad, nunca un UUID ni un monto inventado.
    await waitFor(() =>
      expect(screen.getByText("Motor Delta · Ana Pérez · Plan Pro anual")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/co1|ct1|op1/)).not.toBeInTheDocument();

    expect(screen.getByText("4 tareas pendientes")).toBeInTheDocument();
  });

  it("una tarea de mañana cae en 'Esta semana', salvo que hoy sea domingo (entonces 'Más adelante')", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const tomorrow = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 10, 0);
    const { handlers } = tasksHandlers([
      makeActivity({
        id: "t-tomorrow",
        subject: "Enviar propuesta",
        dueDate: tomorrow.toISOString(),
      }),
    ]);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Enviar propuesta")).toBeInTheDocument());

    const expected = NOW.getDay() === 0 ? "Más adelante" : "Esta semana";
    expect(within(group(expected)).getByText("Enviar propuesta")).toBeInTheDocument();
  });

  it("(b) tildar el checkbox dispara PATCH { completedAt: ahora } y la fila pasa en el acto a 'Esperando confirmación', sin checkbox y con la fecha de completada (§29)", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());

    const before = Date.now();
    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));

    // La fila QUEDA, en el último bloque, grisada y sin nada que tildar.
    expect(screen.queryByRole("heading", { name: /^Vencidas/ })).not.toBeInTheDocument();
    const headings = screen
      .getAllByRole("region")
      .map((region) => within(region).getByRole("heading", { level: 2 }).textContent);
    expect(headings).toEqual(["Hoy1", "Más adelante1", "Sin fecha1", "Esperando confirmación1"]);
    const row = within(group("Esperando confirmación"))
      .getByText("Llamar a Andrés")
      .closest("li") as HTMLElement;
    expect(row).toHaveClass("ds-task-row--awaiting");
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Completar: Llamar a Andrés" }),
    ).not.toBeInTheDocument();
    expect(within(row).getByText(/^Completada hoy/)).toBeInTheDocument();
    expect(screen.getByText("3 tareas pendientes · 1 esperando confirmación")).toBeInTheDocument();

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    const patch = captured.patches[0];
    expect(patch?.id).toBe("t-overdue");
    expect(Object.keys(patch?.body ?? {})).toEqual(["completedAt"]);
    const completedAt = new Date(patch?.body.completedAt ?? "").getTime();
    expect(completedAt).toBeGreaterThanOrEqual(before);
    expect(completedAt).toBeLessThanOrEqual(Date.now());
  });

  it("(c) si el PATCH falla, la fila vuelve a su bloque y se muestra el error", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const { handlers, captured } = tasksHandlers(SAMPLE, { patchStatus: 403 });
    server.use(...handlers);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No pudimos completar la tarea: No tenés permisos para realizar esta acción",
      ),
    );
    expect(within(group("Vencidas")).getByText("Llamar a Andrés")).toBeInTheDocument();
    expect(screen.getByText("4 tareas pendientes")).toBeInTheDocument();
  });

  it("(d) buscador y filtro de tipo son client-side: filtran sin pedir nada nuevo, y el contador sigue lo filtrado", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Depurar duplicados")).toBeInTheDocument());
    const requestsBefore = captured.listRequests.length;

    await user.selectOptions(screen.getByLabelText("Tipo"), "TASK");
    expect(screen.getByText("Revisión trimestral")).toBeInTheDocument();
    expect(screen.getByText("Depurar duplicados")).toBeInTheDocument();
    expect(screen.queryByText("Llamar a Andrés")).not.toBeInTheDocument();
    expect(screen.getByText("2 tareas pendientes")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Buscar tarea…"), "depurar");
    expect(screen.getByText("Depurar duplicados")).toBeInTheDocument();
    expect(screen.queryByText("Revisión trimestral")).not.toBeInTheDocument();
    expect(screen.getByText("1 tarea pendiente")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Buscar tarea…"), "zzz");
    expect(screen.getByText("Ninguna tarea pendiente coincide con el filtro.")).toBeInTheDocument();

    expect(captured.listRequests).toHaveLength(requestsBefore);
  });

  it("(e) '+ Nueva tarea' navega con ?assigneeId=<yo> y SOLO aparece para ADMIN", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers } = tasksHandlers(SAMPLE);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());
    expect(screen.getByText("+ Nueva tarea")).toHaveAttribute(
      "href",
      "/activities/new?assigneeId=u1",
    );
  });

  it("(f) USER: no ve '+ Nueva tarea' ni el link de editar en el título, pero SÍ puede tildar el checkbox", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequests = 0;
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(
      ...handlers,
      http.get(usersUrl, () => {
        usersRequests += 1;
        return HttpResponse.json({ data: [], pagination: {} });
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());

    expect(screen.queryByText("+ Nueva tarea")).not.toBeInTheDocument();
    expect(screen.getByText("Llamar a Andrés").closest("a")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));
    await waitFor(() => expect(captured.patches).toHaveLength(1));
    expect(captured.patches[0]?.body).toHaveProperty("completedAt");
    // Pasa a "Esperando confirmación" (§29), no desaparece.
    expect(
      within(group("Esperando confirmación")).getByText("Llamar a Andrés"),
    ).toBeInTheDocument();

    // Esta página nunca resuelve usuarios: ni para USER ni para nadie.
    expect(usersRequests).toBe(0);
  });

  it("ADMIN: el título es un link a editar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers } = tasksHandlers(SAMPLE);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());
    expect(screen.getByText("Llamar a Andrés").closest("a")).toHaveAttribute(
      "href",
      "/activities/t-overdue/edit",
    );
  });

  it("junta todas las páginas del backend", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE, { pageSize: 3 });
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("4 tareas pendientes")).toBeInTheDocument());
    const pages = captured.listRequests.map((url) => url.searchParams.get("page"));
    expect(pages).toEqual(expect.arrayContaining(["1", "2"]));
  });

  it("sin tareas pendientes: empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const { handlers } = tasksHandlers([]);
    server.use(...handlers);

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("No tenés tareas pendientes.")).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // Confirmación del ADMIN (docs/frontend-cambios-pendientes.md §29): el
  // bloque "Esperando confirmación" y cuándo una tarea deja esta pantalla.
  // -------------------------------------------------------------------------

  it("§29 una tarea ya tildada al cargar aparece en 'Esperando confirmación', grisada, sin checkbox y con 'Completada el <fecha>' en vez del vencimiento", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    // Completada hace dos días (a las 16:30 local), aunque vencía hoy: el
    // bloque lo decide completedAt, no el vencimiento.
    const completedAt = new Date(
      NOW.getFullYear(),
      NOW.getMonth(),
      NOW.getDate() - 2,
      16,
      30,
    ).toISOString();
    const { handlers } = tasksHandlers([
      ...SAMPLE,
      makeActivity({
        id: "t-espera",
        subject: "Enviar contrato",
        dueDate: todayLate,
        completedAt,
      }),
    ]);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Enviar contrato")).toBeInTheDocument());

    const region = group("Esperando confirmación");
    const row = within(region).getByText("Enviar contrato").closest("li") as HTMLElement;
    expect(row).toHaveClass("ds-task-row--awaiting");
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(row).getByText(/^Completada el .*, 16:30$/)).toBeInTheDocument();
    expect(within(row).queryByText("Hoy")).not.toBeInTheDocument();
    // No cuenta como pendiente, y "Hoy" sigue con su única tarea.
    expect(within(group("Hoy")).queryByText("Enviar contrato")).not.toBeInTheDocument();
    expect(screen.getByText("4 tareas pendientes · 1 esperando confirmación")).toBeInTheDocument();
  });

  it("§29 la fila se va de verdad recién cuando el backend la devuelve confirmada: sobrevive al refetch tras el PATCH y desaparece tras la confirmación del ADMIN", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);
    const user = userEvent.setup();

    const queryClient = renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());
    const listsBefore = captured.listRequests.length;

    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));
    await waitFor(() => expect(captured.patches).toHaveLength(1));
    // El PATCH exitoso invalida el listado: llega un segundo fetch, que
    // devuelve la tarea completada y sin confirmar → sigue en el bloque.
    await waitFor(() => expect(captured.listRequests.length).toBeGreaterThan(listsBefore));
    await waitFor(() =>
      expect(
        within(group("Esperando confirmación")).getByText("Llamar a Andrés"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("3 tareas pendientes · 1 esperando confirmación")).toBeInTheDocument();

    // Un ADMIN la confirma desde "Actividades" (fuera de esta pantalla): el
    // server ya no la devuelve con confirmed=false, y al próximo refetch se va.
    captured.state = captured.state.map((a) =>
      a.id === "t-overdue"
        ? { ...a, confirmedAt: new Date().toISOString(), confirmedById: "u9" }
        : a,
    );
    await queryClient.invalidateQueries({ queryKey: activityKeys.lists() });

    await waitFor(() => expect(screen.queryByText("Llamar a Andrés")).not.toBeInTheDocument());
    expect(
      screen.queryByRole("heading", { name: /^Esperando confirmación/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("3 tareas pendientes")).toBeInTheDocument();
  });

  it("§29 ADMIN que tilda la suya: el server la devuelve ya confirmada (auto-confirmación) y la fila desaparece sin pasar por 'Esperando confirmación'", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE, { autoConfirm: true });
    server.use(...handlers);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));
    await waitFor(() => expect(captured.patches).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Llamar a Andrés")).not.toBeInTheDocument());
    expect(
      screen.queryByRole("heading", { name: /^Esperando confirmación/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("3 tareas pendientes")).toBeInTheDocument();
  });
});
