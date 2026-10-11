import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import type { AuthContextValue, MeResponse, RoleName } from "../../auth/AuthContext";
import { automotoraDeMe, clinicaDeMe } from "../../test/rubroFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeConversation, makeConversationDetail } from "../../test/conversationFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { makeBooking } from "../../test/bookingFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { makeServiceType } from "../../test/serviceTypeFixtures";
import { makeKnowledgeBaseEntry } from "../../test/knowledgeBaseFixtures";
import { makeAgent } from "../../test/agentFixtures";
import { makeAutomation } from "../../test/automationFixtures";
import { makeUser } from "../../test/userFixtures";
import { makeActivity } from "../../test/activityFixtures";
import { makeDashboardSummary, makeRevenueSeries } from "../../test/dashboardFixtures";
import { stubResizeObserver } from "../../test/resizeObserverStub";
import { ThemeProvider } from "../../theme/ThemeContext";
import { AppLayout } from "../../layout/AppLayout";
import { DashboardPage } from "../dashboard/DashboardPage";
import { ContactListPage } from "../contact/ContactListPage";
import { ContactFormPage } from "../contact/ContactFormPage";
import { ConversationListPage } from "../conversation/ConversationListPage";
import { ConversationDetail } from "../conversation/ConversationDetail";
import { BranchListPage } from "../branch/BranchListPage";
import { BranchFormPage } from "../branch/BranchFormPage";
import { BookingListPage } from "../booking/BookingListPage";
import { BookingCalendarPage } from "../booking/BookingCalendarPage";
import { KnowledgeBaseListPage } from "../knowledgeBase/KnowledgeBaseListPage";
import { AutomationListPage } from "../automation/AutomationListPage";
import { AutomationFormPage } from "../automation/AutomationFormPage";
import { AgentListPage } from "../agent/AgentListPage";
import { AgentFormPage } from "../agent/AgentFormPage";

// ---------------------------------------------------------------------------
// Los textos de las pantallas compartidas por rubro (docs/rubros.md §3.1).
//
// - CLINICA con contactTerm PACIENTE: recorre las pantallas y falla si en lo
//   visible (texto, opciones, placeholders, aria-label, title) aparece
//   "cliente", "vehículo", "stock" o "test drive".
// - AUTOMOTORA: los textos de cada pantalla son los de antes de R17b
//   (snapshot tomado antes de tocar las pantallas; suite "automotora sin
//   cambios", §14.1). Si el snapshot cambia, cambió lo que ve una automotora.
// ---------------------------------------------------------------------------

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

// El gráfico de ingresos del dashboard de una automotora (Recharts).
stubResizeObserver(600);

function sesion(role: RoleName, rubro: Partial<MeResponse>): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "persona@example.com",
      fullName: "Ana Pérez",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
      canUseInternalAgent: true,
      ...rubro,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

// --- Datos -----------------------------------------------------------------

const paginado = (data: unknown[]) =>
  HttpResponse.json({
    data,
    pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
  });

const CONTACTO = makeContact({ id: "ct1", lifecycleStage: "CUSTOMER", ownerId: "u1" });
const SUCURSAL = makeBranch({ id: "b1", name: "Casa Central" });
const RECURSO = makeResource({ id: "r1", branchId: "b1", name: "Lucía Ejemplo" });
const SERVICIO = makeServiceType({ id: "s1", branchId: "b1", resourceId: "r1", name: "Consulta" });

/** Lo que devuelve cada GET de la API, por ruta. Lo que no está acá es una
 *  lista vacía. */
function respuesta(path: string): Response {
  const p = path.replace(/^\/api/, "");
  if (p === "/contact-custom-fields") return HttpResponse.json([]);
  if (p === "/opportunities/dashboard-summary") return HttpResponse.json(makeDashboardSummary());
  if (p === "/opportunities/revenue-series") return HttpResponse.json(makeRevenueSeries());
  if (/^\/contacts\/[^/]+\/vouchers$/.test(p)) return HttpResponse.json({ data: [] });
  if (/^\/branches\/[^/]+\/business-hours$/.test(p)) {
    return HttpResponse.json({ configured: true, businessHours: [], defaultBusinessHours: [] });
  }
  if (/^\/branches\/[^/]+\/google-calendar$/.test(p)) {
    return HttpResponse.json({ error: "No conectado" }, { status: 404 });
  }
  if (/^\/clinica\/sedes\/[^/]+\/configuracion$/.test(p)) {
    return HttpResponse.json({
      minHoursToChangeBooking: null,
      reminderHoursBefore: 24,
      lateBookingReminder: "NO_ENVIAR",
      lateBookingHoursBefore: 2,
    });
  }
  if (/^\/resources\/[^/]+\/working-hours$/.test(p)) return HttpResponse.json({ workingHours: [] });
  if (p === "/contacts") return paginado([CONTACTO]);
  if (/^\/contacts\/[^/]+$/.test(p)) return HttpResponse.json(CONTACTO);
  if (p === "/conversations") return paginado([makeConversation()]);
  if (/^\/conversations\/[^/]+$/.test(p)) return HttpResponse.json(makeConversationDetail());
  if (p === "/branches") return paginado([SUCURSAL]);
  if (/^\/branches\/[^/]+$/.test(p)) return HttpResponse.json(SUCURSAL);
  if (p === "/bookings") return paginado([makeBooking({ contactId: "ct1" })]);
  if (p === "/resources") return paginado([RECURSO]);
  if (p === "/service-types") return paginado([SERVICIO]);
  if (p === "/knowledge-base") return paginado([makeKnowledgeBaseEntry({ branchId: "b1" })]);
  if (p === "/agents") return paginado([makeAgent({ branchId: "b1" })]);
  if (p === "/automations") return paginado([makeAutomation()]);
  if (p === "/users") return paginado([makeUser({ id: "u1", fullName: "Ana Pérez" })]);
  if (p === "/activities") return paginado([makeActivity({ subject: "Llamar a Juana" })]);
  if (p === "/dashboard/atencion") {
    return HttpResponse.json({
      periodo: { label: "octubre 2026", start: "", end: "" },
      conversacionesNuevas: {
        total: 0,
        porCanal: { WHATSAPP: 0, WEB: 0, INSTAGRAM: 0, MESSENGER: 0 },
      },
      derivaciones: 0,
      derivacionesSinRespuesta: 0,
      consultasPendientes: { esperandoRespuesta: 0, seguimientosAgendados: 0 },
      tareasVencidas: 0,
    });
  }
  return paginado([]);
}

const PEDIDOS: string[] = [];

beforeEach(() => {
  // Un día fijo, el del turno de la fixture: la agenda lo muestra y el
  // snapshot no depende de la fecha en que corre.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-22T13:00:00.000Z") });
  PEDIDOS.length = 0;
  server.use(
    http.get(/\/api\//, ({ request }) => {
      const path = new URL(request.url).pathname;
      PEDIDOS.push(path);
      return respuesta(path);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Pantallas -------------------------------------------------------------

interface Pantalla {
  nombre: string;
  url: string;
  patron: string;
  elemento: ReactNode;
}

const PANTALLAS: Pantalla[] = [
  { nombre: "menú", url: "/", patron: "*", elemento: null },
  { nombre: "dashboard", url: "/", patron: "/", elemento: <DashboardPage /> },
  { nombre: "contactos", url: "/contacts", patron: "/contacts", elemento: <ContactListPage /> },
  {
    nombre: "consultas sin identificar",
    url: "/contacts?vista=consultas",
    patron: "/contacts",
    elemento: <ContactListPage />,
  },
  {
    nombre: "contacto nuevo",
    url: "/contacts/new",
    patron: "/contacts/new",
    elemento: <ContactFormPage />,
  },
  {
    nombre: "ficha de contacto",
    url: "/contacts/ct1/edit",
    patron: "/contacts/:id/edit",
    elemento: <ContactFormPage />,
  },
  {
    nombre: "conversaciones",
    url: "/conversations",
    patron: "/conversations",
    elemento: <ConversationListPage />,
  },
  {
    nombre: "conversación",
    url: "/conversations/conv-1",
    patron: "/conversations/:id",
    elemento: <ConversationDetail />,
  },
  { nombre: "sucursales", url: "/branches", patron: "/branches", elemento: <BranchListPage /> },
  {
    nombre: "sucursal",
    url: "/branches/b1/edit",
    patron: "/branches/:id/edit",
    elemento: <BranchFormPage />,
  },
  { nombre: "turnos", url: "/bookings", patron: "/bookings", elemento: <BookingListPage /> },
  { nombre: "agenda", url: "/agenda", patron: "/agenda", elemento: <BookingCalendarPage /> },
  {
    nombre: "base de conocimiento",
    url: "/knowledge-base",
    patron: "/knowledge-base",
    elemento: <KnowledgeBaseListPage />,
  },
  {
    nombre: "automatizaciones",
    url: "/automations",
    patron: "/automations",
    elemento: <AutomationListPage />,
  },
  {
    nombre: "automatización nueva",
    url: "/automations/new",
    patron: "/automations/new",
    elemento: <AutomationFormPage />,
  },
  { nombre: "agentes", url: "/agents", patron: "/agents", elemento: <AgentListPage /> },
  {
    nombre: "agente nuevo",
    url: "/agents/new",
    patron: "/agents/new",
    elemento: <AgentFormPage />,
  },
];

/** El texto visible de la página, en orden: cada nodo de texto y los
 *  atributos que se leen (placeholder, aria-label, title, alt). */
function textoVisible(raiz: HTMLElement): string[] {
  const textos: string[] = [];
  const recorrer = (nodo: Node) => {
    if (nodo.nodeType === Node.TEXT_NODE) {
      const texto = (nodo.textContent ?? "").replace(/\s+/g, " ").trim();
      if (texto) textos.push(texto);
      return;
    }
    if (!(nodo instanceof HTMLElement)) return;
    if (nodo.tagName === "SCRIPT" || nodo.tagName === "STYLE") return;
    for (const atributo of ["placeholder", "aria-label", "title", "alt"]) {
      const valor = nodo.getAttribute(atributo);
      if (valor) textos.push(`[${atributo}] ${valor}`);
    }
    nodo.childNodes.forEach(recorrer);
  };
  recorrer(raiz);
  return textos;
}

async function textosDe(pantalla: Pantalla, auth: AuthContextValue): Promise<string[]> {
  useAuthMock.mockReturnValue(auth);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[pantalla.url]}>
          <Routes>
            {pantalla.nombre === "menú" ? (
              <Route element={<AppLayout />}>
                <Route path="*" element={null} />
              </Route>
            ) : (
              <Route path={pantalla.patron} element={pantalla.elemento} />
            )}
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  // Que termine de cargar: ningún pedido en vuelo y nada "Cargando", dos
  // veces seguidas (hay pedidos que salen recién cuando llega otro, como los
  // nombres de los contactos de la agenda).
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
      expect(container.textContent ?? "").not.toMatch(/Cargando/i);
    });
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  expect(screen.queryByText(/No pudimos cargar/i), pantalla.nombre).toBeNull();
  const textos = textoVisible(container);
  unmount();
  return textos;
}

// Lo que pide §3.1. \b no parte "clientela" ni "reservar".
const PALABRAS_DE_AUTOMOTORA = /\b(clientes?|veh[ií]culos?|stock|test ?drives?)\b/i;
// Y el vocabulario de la automotora que la clínica dice de otra forma (§3).
const VOCABULARIO_DE_AUTOMOTORA =
  /\b(vendedor(es)?|reservas?|recursos?|tipos? de servicio|sucursal(es)?)\b/i;

describe("textos de una clínica (§3.1): nada de autos", () => {
  for (const pantalla of PANTALLAS) {
    it(pantalla.nombre, async () => {
      const textos = await textosDe(pantalla, sesion("ADMIN", clinicaDeMe("COMPLETA")));
      expect(textos.length).toBeGreaterThan(0);
      expect(textos.filter((t) => PALABRAS_DE_AUTOMOTORA.test(t)).join(" | ")).toBe("");
      expect(textos.filter((t) => VOCABULARIO_DE_AUTOMOTORA.test(t)).join(" | ")).toBe("");
    });
  }
});

describe("automotora sin cambios: los textos de antes de R17b", () => {
  for (const pantalla of PANTALLAS) {
    it(pantalla.nombre, async () => {
      const textos = await textosDe(pantalla, sesion("ADMIN", automotoraDeMe("COMPLETA")));
      expect(textos.length).toBeGreaterThan(0);
      expect(textos).toMatchSnapshot();
    });
  }
});
