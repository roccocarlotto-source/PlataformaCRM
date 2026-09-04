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
    me: { id: "u1", email: "a@x.com", fullName: "A", organizationId: "org-1", role },
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
}

function tasksHandlers(
  activities: Activity[],
  options: { pageSize?: number; patchStatus?: number } = {},
): { handlers: ReturnType<typeof http.get>[]; captured: Captured } {
  const captured: Captured = { listRequests: [], patches: [] };
  const pageSize = options.pageSize ?? 100;
  const handlers = [
    http.get(activitiesUrl, ({ request }) => {
      const url = new URL(request.url);
      captured.listRequests.push(url);
      const page = Number(url.searchParams.get("page") ?? "1");
      return HttpResponse.json({
        data: activities.slice((page - 1) * pageSize, page * pageSize),
        pagination: {
          page,
          pageSize,
          total: activities.length,
          totalPages: Math.max(1, Math.ceil(activities.length / pageSize)),
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
      const original = activities.find((a) => a.id === params.id) ?? makeActivity();
      return HttpResponse.json({ ...original, ...body });
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
}

function group(name: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

describe("MyTasksPage", () => {
  it("(a) pide SOLO las pendientes asignadas a mí y las agrupa por vencimiento en orden, ocultando los bloques vacíos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);

    renderPage();
    await waitFor(() => expect(screen.getByText("Depurar duplicados")).toBeInTheDocument());

    const request = captured.listRequests[0];
    expect(request?.searchParams.get("assigneeId")).toBe("u1");
    expect(request?.searchParams.get("completed")).toBe("false");
    expect(request?.searchParams.get("pageSize")).toBe("100");
    expect(request?.searchParams.get("sortBy")).toBe("dueDate");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
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

  it("(b) tildar el checkbox dispara PATCH { completedAt: ahora } y la fila desaparece en el acto", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = tasksHandlers(SAMPLE);
    server.use(...handlers);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar a Andrés")).toBeInTheDocument());

    const before = Date.now();
    await user.click(screen.getByRole("checkbox", { name: "Completar: Llamar a Andrés" }));

    expect(screen.queryByText("Llamar a Andrés")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Vencidas/ })).not.toBeInTheDocument();
    expect(screen.getByText("3 tareas pendientes")).toBeInTheDocument();

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
    expect(screen.queryByText("Llamar a Andrés")).not.toBeInTheDocument();

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
});
