import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { OpportunityBoardView } from "./OpportunityBoardView";
import { todayIsoDate } from "./boardMove";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { Opportunity, UpdateOpportunityInput } from "./types";
import type { Stage } from "../stage/types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

// ---------------------------------------------------------------------------
// CÓMO SE PRUEBA EL DROP SIN SIMULAR UN ARRASTRE PIXEL A PIXEL.
//
// @dnd-kit no expone un helper de testing, y su detección de colisiones
// depende de getBoundingClientRect, que en jsdom devuelve siempre 0×0: todas
// las columnas "están" en el mismo lugar, así que un drag simulado con
// teclado o mouse no podría elegir la columna destino de forma confiable.
//
// Por eso acá @dnd-kit/core se reemplaza por un doble mínimo: DndContext
// renderiza sus hijos y CAPTURA el onDragEnd que le pasa el tablero;
// useDraggable/useDroppable devuelven valores inertes. Cada test dispara
// el drop llamando a ese onDragEnd con el mismo evento que dnd-kit
// produciría ({ active: { id }, over: { id } }) y verifica lo que importa:
// el PATCH que sale, la tarjeta que se mueve y la reversión si falla.
//
// Las reglas del PATCH en sí (WON/LOST/reapertura/no pisar la fecha) tienen
// su propia batería sobre la función pura en boardMove.test.ts. Lo que
// dnd-kit hace con el mouse real es responsabilidad de dnd-kit.
// ---------------------------------------------------------------------------
type DragEndHandler = (event: { active: { id: string }; over: { id: string } | null }) => void;
const dnd = vi.hoisted(() => ({ onDragEnd: null as DragEndHandler | null }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: DragEndHandler;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCorners: () => [],
}));

async function drop(activeId: string, overId: string) {
  if (!dnd.onDragEnd) throw new Error("DndContext todavía no montó");
  const handler = dnd.onDragEnd;
  await act(async () => {
    handler({ active: { id: activeId }, over: { id: overId } });
  });
}

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

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const contactsUrl = `${env.apiUrl}/api/contacts`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;

// Un pipeline con las cuatro etapas del caso típico: dos normales, la
// ganada y la perdida. El orden del array es el `order` real que devuelve
// el backend (ya ordenado) — el tablero no reordena nada por su cuenta.
const STAGES: Stage[] = [
  makeStage({ id: "st-prospecto", pipelineId: "pl1", name: "Prospecto", order: 1 }),
  makeStage({ id: "st-propuesta", pipelineId: "pl1", name: "Propuesta", order: 2 }),
  makeStage({ id: "st-ganada", pipelineId: "pl1", name: "Ganada", order: 3, isWon: true }),
  makeStage({ id: "st-perdida", pipelineId: "pl1", name: "Perdida", order: 4, isLost: true }),
];

interface Captured {
  stageRequests: URL[];
  opportunityRequests: URL[];
  patches: { id: string; body: UpdateOpportunityInput }[];
}

function boardHandlers(
  opportunities: Opportunity[],
  options: { pageSize?: number; patchStatus?: number; stages?: Stage[] } = {},
): { handlers: ReturnType<typeof http.get>[]; captured: Captured } {
  const captured: Captured = { stageRequests: [], opportunityRequests: [], patches: [] };
  const stages = options.stages ?? STAGES;
  // pageSize del servidor: permite forzar varias páginas con pocas
  // fixtures, sin importar el pageSize=100 que pide el cliente.
  const pageSize = options.pageSize ?? 100;

  const handlers = [
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [makePipeline({ id: "pl1", name: "Ventas" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
    http.get(stagesUrl, ({ request }) => {
      captured.stageRequests.push(new URL(request.url));
      return HttpResponse.json({
        data: stages,
        pagination: { page: 1, pageSize: 100, total: stages.length, totalPages: 1 },
      });
    }),
    http.get(opportunitiesUrl, ({ request }) => {
      const url = new URL(request.url);
      captured.opportunityRequests.push(url);
      const page = Number(url.searchParams.get("page") ?? "1");
      const data = opportunities.slice((page - 1) * pageSize, page * pageSize);
      return HttpResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: opportunities.length,
          totalPages: Math.max(1, Math.ceil(opportunities.length / pageSize)),
        },
      });
    }),
    http.patch(`${opportunitiesUrl}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as UpdateOpportunityInput;
      captured.patches.push({ id: params.id as string, body });
      if (options.patchStatus && options.patchStatus >= 400) {
        return HttpResponse.json(
          { error: { message: "etapa inválida" } },
          { status: options.patchStatus },
        );
      }
      const original = opportunities.find((o) => o.id === params.id) ?? makeOpportunity();
      return HttpResponse.json({ ...original, ...body, updatedAt: "2026-09-04T12:00:00.000Z" });
    }),
    http.get(`${companiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: params.id as string, firstName: "Ana", lastName: "Pérez" }),
      ),
    ),
    http.get(usersUrl, () =>
      HttpResponse.json({
        data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
  return { handlers, captured };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OpportunityBoardView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function column(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("OpportunityBoardView", () => {
  it("(a) las columnas son las etapas reales del pipeline, en su orden, pedidas por `order` asc", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers([makeOpportunity({ stageId: "st-prospecto" })]);
    server.use(...handlers);

    renderBoard();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Prospecto", "Propuesta", "Ganada", "Perdida"]);

    // El pipeline se autoseleccionó (único de la lista) y las etapas se
    // pidieron scoped a él, ordenadas por `order`, con el tope real de 100.
    const stagesRequest = captured.stageRequests[0];
    expect(stagesRequest?.searchParams.get("pipelineId")).toBe("pl1");
    expect(stagesRequest?.searchParams.get("sortBy")).toBe("order");
    expect(stagesRequest?.searchParams.get("sortOrder")).toBe("asc");
    expect(stagesRequest?.searchParams.get("pageSize")).toBe("100");

    // Y las oportunidades se pidieron del pipeline, SIN filtro de status.
    const opportunitiesRequest = captured.opportunityRequests[0];
    expect(opportunitiesRequest?.searchParams.get("pipelineId")).toBe("pl1");
    expect(opportunitiesRequest?.searchParams.has("status")).toBe(false);

    // La tarjeta está en su columna, con cantidad y total de esa columna.
    const prospecto = column("Prospecto");
    expect(within(prospecto).getByText("Renovación anual")).toBeInTheDocument();
    // Dos veces: en la tarjeta y en el footer "Total" de la columna.
    expect(within(prospecto).getAllByText("1500.00 USD")).toHaveLength(2);
    expect(within(column("Propuesta")).getByText("—")).toBeInTheDocument();
  });

  it("(b) las etapas isWon/isLost llevan su tratamiento visual y NO tienen '+ Añadir'; las normales sí", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers } = boardHandlers([makeOpportunity({ stageId: "st-prospecto" })]);
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());

    expect(column("Ganada")).toHaveClass("ds-board-column--won");
    expect(column("Perdida")).toHaveClass("ds-board-column--lost");
    expect(column("Prospecto")).not.toHaveClass("ds-board-column--won");
    expect(column("Prospecto")).not.toHaveClass("ds-board-column--lost");

    expect(within(column("Ganada")).queryByText("+ Añadir")).not.toBeInTheDocument();
    expect(within(column("Perdida")).queryByText("+ Añadir")).not.toBeInTheDocument();

    // "+ Añadir" preselecciona pipeline y etapa en el formulario de alta.
    const add = within(column("Propuesta")).getByText("+ Añadir");
    expect(add).toHaveAttribute("href", "/opportunities/new?pipelineId=pl1&stageId=st-propuesta");
  });

  it("(c) soltar en una columna isWon manda PATCH con status WON y actualCloseDate hoy, y mueve la tarjeta ya", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers([
      makeOpportunity({ id: "op1", stageId: "st-prospecto", status: "OPEN" }),
    ]);
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());

    await drop("op1", "st-ganada");

    // Movimiento local inmediato: la tarjeta ya está en "Ganada", con la
    // fecha de cierre real de hoy.
    expect(within(column("Ganada")).getByText("Renovación anual")).toBeInTheDocument();
    expect(within(column("Ganada")).getByText("Cierre real")).toBeInTheDocument();
    expect(within(column("Prospecto")).queryByText("Renovación anual")).not.toBeInTheDocument();

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    expect(captured.patches[0]).toEqual({
      id: "op1",
      body: { stageId: "st-ganada", status: "WON", actualCloseDate: todayIsoDate() },
    });
    // lostReason nunca viaja en un drag.
    expect(captured.patches[0]?.body).not.toHaveProperty("lostReason");
  });

  it("(d) soltar una oportunidad cerrada en una columna normal la reabre: status OPEN y actualCloseDate null", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers([
      makeOpportunity({
        id: "op1",
        stageId: "st-perdida",
        status: "LOST",
        actualCloseDate: "2026-08-01T00:00:00.000Z",
        lostReason: "Precio",
      }),
    ]);
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());

    await drop("op1", "st-propuesta");

    expect(within(column("Propuesta")).getByText("Renovación anual")).toBeInTheDocument();
    expect(within(column("Propuesta")).getByText("Estimado")).toBeInTheDocument();

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    expect(captured.patches[0]).toEqual({
      id: "op1",
      body: { stageId: "st-propuesta", status: "OPEN", actualCloseDate: null },
    });
  });

  it("mover entre dos etapas normales estando OPEN manda solo stageId; soltar en la misma columna no manda nada", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers([
      makeOpportunity({ id: "op1", stageId: "st-prospecto", status: "OPEN" }),
    ]);
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());

    await drop("op1", "st-prospecto");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captured.patches).toHaveLength(0);

    await drop("op1", "st-propuesta");
    await waitFor(() => expect(captured.patches).toHaveLength(1));
    expect(captured.patches[0]?.body).toEqual({ stageId: "st-propuesta" });
  });

  it("si el PATCH falla, la tarjeta vuelve a su columna y el error se muestra", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers(
      [makeOpportunity({ id: "op1", stageId: "st-prospecto", status: "OPEN" })],
      { patchStatus: 422 },
    );
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());

    // No se afirma el estado intermedio (la tarjeta en "Ganada" antes de la
    // respuesta): con msw el 422 llega dentro del mismo act y la reversión
    // ya ocurrió. Lo que importa acá es el estado final.
    await drop("op1", "st-ganada");

    await waitFor(() => expect(captured.patches).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("etapa inválida"));
    expect(within(column("Prospecto")).getByText("Renovación anual")).toBeInTheDocument();
    expect(within(column("Ganada")).queryByText("Renovación anual")).not.toBeInTheDocument();
  });

  it("trae TODAS las páginas del pipeline y las junta; el contador cuenta solo las OPEN como 'en curso'", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers(
      [
        makeOpportunity({ id: "op1", title: "Uno", stageId: "st-prospecto", amount: "100.00" }),
        makeOpportunity({ id: "op2", title: "Dos", stageId: "st-propuesta", amount: "250.00" }),
        makeOpportunity({
          id: "op3",
          title: "Tres",
          stageId: "st-ganada",
          status: "WON",
          amount: "999.00",
        }),
      ],
      { pageSize: 2 },
    );
    server.use(...handlers);

    renderBoard();

    await waitFor(() => expect(screen.getByText("Tres")).toBeInTheDocument());
    expect(screen.getByText("Uno")).toBeInTheDocument();
    expect(screen.getByText("Dos")).toBeInTheDocument();

    const pages = captured.opportunityRequests.map((url) => url.searchParams.get("page"));
    expect(pages).toEqual(expect.arrayContaining(["1", "2"]));
    expect(captured.opportunityRequests.every((u) => u.searchParams.get("pageSize") === "100"));

    // 3 oportunidades en total; en curso solo las OPEN: 100 + 250, no 999.
    expect(screen.getByText("3 oportunidades · 350.00 USD en curso")).toBeInTheDocument();
  });

  it("el buscador filtra por título client-side, sin pedir nada nuevo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers, captured } = boardHandlers([
      makeOpportunity({ id: "op1", title: "Renovación anual", stageId: "st-prospecto" }),
      makeOpportunity({ id: "op2", title: "Licencias nuevas", stageId: "st-prospecto" }),
    ]);
    server.use(...handlers);
    const user = userEvent.setup();

    renderBoard();
    await waitFor(() => expect(screen.getByText("Licencias nuevas")).toBeInTheDocument());
    const requestsBefore = captured.opportunityRequests.length;

    await user.type(screen.getByPlaceholderText("Buscar oportunidad…"), "licen");

    expect(screen.getByText("Licencias nuevas")).toBeInTheDocument();
    expect(screen.queryByText("Renovación anual")).not.toBeInTheDocument();
    expect(captured.opportunityRequests).toHaveLength(requestsBefore);
  });

  it("USER: no ve el avatar del propietario, ni '+ Añadir', y no dispara GET /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequests = 0;
    const { handlers } = boardHandlers([makeOpportunity({ stageId: "st-prospecto" })]);
    server.use(
      ...handlers,
      http.get(usersUrl, () => {
        usersRequests += 1;
        return HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderBoard();
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(usersRequests).toBe(0);
    expect(screen.queryByRole("img", { name: "Ana Pérez" })).not.toBeInTheDocument();
    expect(screen.queryByText("+ Añadir")).not.toBeInTheDocument();
  });

  it("ADMIN ve el avatar del propietario en la tarjeta", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { handlers } = boardHandlers([
      makeOpportunity({ stageId: "st-prospecto", ownerId: "u1" }),
    ]);
    server.use(...handlers);

    renderBoard();
    await waitFor(() => expect(screen.getByRole("img", { name: "Ana Pérez" })).toBeInTheDocument());
  });

  it("sin pipelines: EmptyState en vez de un tablero vacío", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(pipelinesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderBoard();
    await waitFor(() => expect(screen.getByText(/No hay pipelines todavía/)).toBeInTheDocument());
  });
});
