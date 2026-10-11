import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { ThemeProvider } from "../theme/ThemeContext";
import type { AuthContextValue, MeResponse, RoleName } from "../auth/AuthContext";
import { edicionDeMe } from "../test/edicionFixtures";
import { automotoraDeMe, clinicaDeMe, VOCABULARIO_CLINICA_DE_ME } from "../test/rubroFixtures";

// ---------------------------------------------------------------------------
// El menú por rubro (docs/rubros.md §1.3, §3.1, R17).
//
// Suite "automotora sin cambios" del frontend (docs/rubros.md §14.1): el menú
// de una automotora, con su marca, para ADMIN y USER en las dos ediciones, tal
// como era ANTES de R17 (el menú por rubro). Se tomó sobre el AppLayout de
// antes de tocarlo. Si este test cambia, cambió lo que ve una automotora: no
// se actualiza el snapshot sin una decisión explícita.
// ---------------------------------------------------------------------------

vi.mock("../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

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
      canUseInternalAgent: false,
      ...rubro,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

/** El menú como texto, en el orden del DOM: los títulos de sección entre
 *  corchetes y cada link con su destino, con sangría por anidamiento. Incluye
 *  los hijos de las secciones plegadas (están montados, con `inert`). */
function menuComoTexto(container: HTMLElement): string[] {
  const lineas: string[] = [];
  for (const marca of container.querySelectorAll(".ds-sidebar-brand-name")) {
    lineas.push(`marca: ${marca.textContent}`);
  }
  const nav = container.querySelector(".ds-sidebar-nav");
  if (!nav) throw new Error("No hay menú");
  for (const el of nav.querySelectorAll("a, .ds-sidebar-group-label")) {
    let nivel = 0;
    for (let p = el.parentElement; p && p !== nav; p = p.parentElement) {
      if (p.classList.contains("ds-sidebar-group-items")) nivel += 1;
    }
    const sangria = "  ".repeat(nivel);
    const texto = el.textContent ?? "";
    lineas.push(
      el.tagName === "A"
        ? `${sangria}${texto} -> ${el.getAttribute("href")}`
        : `${sangria}[${texto}]`,
    );
  }
  return lineas;
}

function renderLayout(auth: AuthContextValue) {
  useAuthMock.mockReturnValue(auth);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={null} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { container, unmount };
}

function menuDe(auth: AuthContextValue): string[] {
  const { container, unmount } = renderLayout(auth);
  const lineas = menuComoTexto(container);
  unmount();
  return lineas;
}

function rotuloDelRol(auth: AuthContextValue): string | null {
  const { container, unmount } = renderLayout(auth);
  const rotulo = container.querySelector(".ds-sidebar-account-role")?.textContent ?? null;
  unmount();
  return rotulo;
}

describe("automotora sin cambios: el menú de antes de R17", () => {
  it("ADMIN, COMPLETA", () => {
    expect(menuDe(sesion("ADMIN", automotoraDeMe("COMPLETA")))).toMatchInlineSnapshot(`
      [
        "marca: Plataforma CRM",
        "marca: Plataforma CRM",
        "Dashboard -> /",
        "Agente interno -> /internal-agent",
        "Canjear cupón -> /vouchers/scan",
        "[CRM]",
        "  Contactos -> /contacts",
        "    Conversaciones -> /conversations",
        "    Empresas -> /companies",
        "    Oportunidades -> /opportunities",
        "  Procesos de venta -> /pipelines",
        "  Stock -> /vehicles",
        "[Actividades]",
        "  Actividades -> /activities",
        "  Mis tareas -> /tasks",
        "  Reservas -> /bookings",
        "  Calendario -> /agenda",
        "  Recursos -> /resources",
        "  Tipos de servicio -> /service-types",
        "[Administración]",
        "  QR -> /qr",
        "  Usuarios -> /users",
        "  Invitaciones -> /invitations",
        "  Fuentes de ingesta -> /sources",
        "  Claves de ingesta -> /api-keys",
        "  Eventos de ingesta -> /ingestion-events",
        "  Organización -> /organization",
        "  Sucursales -> /branches",
        "  Campos de contacto -> /contact-custom-fields",
        "Agentes de IA -> /agents",
        "  Base de conocimiento -> /knowledge-base",
        "  Automatizaciones -> /automations",
        "  Configurar agente interno -> /internal-agent/settings",
        "Ayuda -> /ayuda",
      ]
    `);
  });

  it("USER, COMPLETA", () => {
    expect(menuDe(sesion("USER", automotoraDeMe("COMPLETA")))).toMatchInlineSnapshot(`
      [
        "marca: Plataforma CRM",
        "marca: Plataforma CRM",
        "Dashboard -> /",
        "Canjear cupón -> /vouchers/scan",
        "[CRM]",
        "  Contactos -> /contacts",
        "    Conversaciones -> /conversations",
        "    Empresas -> /companies",
        "    Oportunidades -> /opportunities",
        "  Procesos de venta -> /pipelines",
        "  Stock -> /vehicles",
        "[Actividades]",
        "  Mis tareas -> /tasks",
        "  Reservas -> /bookings",
        "  Calendario -> /agenda",
        "[Administración]",
        "  QR -> /qr",
        "Ayuda -> /ayuda",
      ]
    `);
  });

  it("ADMIN, ESENCIAL", () => {
    expect(menuDe(sesion("ADMIN", automotoraDeMe("ESENCIAL")))).toMatchInlineSnapshot(`
      [
        "marca: Plataforma CRM",
        "marca: Plataforma CRM",
        "Dashboard -> /",
        "Agente interno -> /internal-agent",
        "Canjear cupón -> /vouchers/scan",
        "[CRM]",
        "  Contactos -> /contacts",
        "    Conversaciones -> /conversations",
        "    Oportunidades -> /opportunities",
        "  Stock -> /vehicles",
        "[Actividades]",
        "  Actividades -> /activities",
        "  Mis tareas -> /tasks",
        "  Reservas -> /bookings",
        "  Calendario -> /agenda",
        "  Recursos -> /resources",
        "  Tipos de servicio -> /service-types",
        "[Administración]",
        "  QR -> /qr",
        "  Usuarios -> /users",
        "  Invitaciones -> /invitations",
        "  Fuentes de ingesta -> /sources",
        "  Claves de ingesta -> /api-keys",
        "  Eventos de ingesta -> /ingestion-events",
        "  Organización -> /organization",
        "  Sucursales -> /branches",
        "  Campos de contacto -> /contact-custom-fields",
        "Agentes de IA -> /agents",
        "  Base de conocimiento -> /knowledge-base",
        "  Automatizaciones -> /automations",
        "  Configurar agente interno -> /internal-agent/settings",
        "Ayuda -> /ayuda",
      ]
    `);
  });

  it("USER, ESENCIAL", () => {
    expect(menuDe(sesion("USER", automotoraDeMe("ESENCIAL")))).toMatchInlineSnapshot(`
      [
        "marca: Plataforma CRM",
        "marca: Plataforma CRM",
        "Dashboard -> /",
        "Canjear cupón -> /vouchers/scan",
        "[CRM]",
        "  Contactos -> /contacts",
        "    Conversaciones -> /conversations",
        "    Oportunidades -> /opportunities",
        "  Stock -> /vehicles",
        "[Actividades]",
        "  Mis tareas -> /tasks",
        "  Reservas -> /bookings",
        "  Calendario -> /agenda",
        "[Administración]",
        "  QR -> /qr",
        "Ayuda -> /ayuda",
      ]
    `);
  });

  it("sin industry ni vocabulario (un backend anterior a los rubros) es el mismo menú", () => {
    for (const role of ["ADMIN", "USER"] as const) {
      for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
        expect(menuDe(sesion(role, edicionDeMe(edition)))).toEqual(
          menuDe(sesion(role, automotoraDeMe(edition))),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// El menú de una clínica (docs/rubros.md §3.1, §11.2): sin nada de autos ni
// de ventas, con los textos del rubro. Recepción ve solo lo operativo.
// ---------------------------------------------------------------------------

const MENU_DE_CLINICA_ADMIN = [
  "marca: Plataforma CRM",
  "marca: Plataforma CRM",
  "Dashboard -> /",
  "Agente interno -> /internal-agent",
  "Agenda -> /agenda",
  "  Turnos -> /bookings",
  "  Bloqueos -> /clinica/bloqueos",
  "  Sobreturnos -> /clinica/sobreturnos",
  "  Profesionales -> /clinica/profesionales",
  "  Prestaciones -> /clinica/prestaciones",
  "  Configurar prestaciones -> /service-types",
  "Pacientes -> /contacts",
  "  Conversaciones -> /conversations",
  "[Tareas]",
  "  Mis tareas -> /tasks",
  "  Todas las tareas -> /activities",
  "Agentes de IA -> /agents",
  "  Base de conocimiento -> /knowledge-base",
  "  Automatizaciones -> /automations",
  "  Configurar agente interno -> /internal-agent/settings",
  "[Administración]",
  "  QR -> /qr",
  "  Usuarios -> /users",
  "  Invitaciones -> /invitations",
  "  Organización -> /organization",
  "  Sedes -> /branches",
  "  Campos de paciente -> /contact-custom-fields",
  "Ayuda -> /ayuda",
];

const MENU_DE_CLINICA_RECEPCION = [
  "marca: Plataforma CRM",
  "marca: Plataforma CRM",
  "Dashboard -> /",
  "Agenda -> /agenda",
  "  Turnos -> /bookings",
  "  Bloqueos -> /clinica/bloqueos",
  "  Sobreturnos -> /clinica/sobreturnos",
  "Pacientes -> /contacts",
  "  Conversaciones -> /conversations",
  "[Tareas]",
  "  Mis tareas -> /tasks",
  "Ayuda -> /ayuda",
];

// Lo que una clínica no ve nunca en el menú (decisión de Rocco para R17).
const FUERA_DEL_MENU_DE_CLINICA =
  /-> \/(vehicles|opportunities|companies|pipelines|vouchers|sources|api-keys|ingestion-events|resources)(\/|$)/;

describe("el menú de una clínica (R17)", () => {
  it("ADMIN, en las dos ediciones", () => {
    for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
      expect(menuDe(sesion("ADMIN", clinicaDeMe(edition))), edition).toEqual(MENU_DE_CLINICA_ADMIN);
    }
  });

  it("Recepción, en las dos ediciones: sin Administración, agentes ni configuración", () => {
    for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
      expect(menuDe(sesion("RECEPCION", clinicaDeMe(edition))), edition).toEqual(
        MENU_DE_CLINICA_RECEPCION,
      );
    }
  });

  it("nunca muestra stock, oportunidades, empresas, procesos de venta, cupones ni ingesta", () => {
    for (const role of ["ADMIN", "RECEPCION", "USER"] as const) {
      for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
        for (const linea of menuDe(sesion(role, clinicaDeMe(edition)))) {
          expect(linea, `${role} ${edition}`).not.toMatch(FUERA_DEL_MENU_DE_CLINICA);
        }
      }
    }
  });

  it("Recepción habilitada ve el agente interno; sin el módulo, nadie lo ve", () => {
    const habilitada = sesion("RECEPCION", clinicaDeMe("COMPLETA"));
    habilitada.me!.canUseInternalAgent = true;
    expect(menuDe(habilitada)).toContain("Agente interno -> /internal-agent");

    const sinModulo = sesion("ADMIN", clinicaDeMe("COMPLETA"));
    sinModulo.me!.modulos = sinModulo.me!.modulos!.filter((m) => m !== "agente_interno");
    const menu = menuDe(sinModulo);
    expect(menu).not.toContain("Agente interno -> /internal-agent");
    expect(menu).not.toContain("  Configurar agente interno -> /internal-agent/settings");
  });

  it("con el término CLIENTE, los textos del contacto son los que eligió la clínica", () => {
    const rubro = clinicaDeMe("COMPLETA");
    rubro.vocabulario = {
      ...VOCABULARIO_CLINICA_DE_ME,
      contacto: {
        singular: "cliente",
        plural: "clientes",
        singularTitulo: "Cliente",
        pluralTitulo: "Clientes",
      },
    };
    const menu = menuDe(sesion("ADMIN", rubro));
    expect(menu).toContain("Clientes -> /contacts");
    expect(menu).toContain("  Campos de cliente -> /contact-custom-fields");
  });
});

// La marca (docs/rubros.md §0.3): sale de `vocabulario.marca` de /me, en la
// sidebar y en la barra del celular, para los dos rubros.
describe("la marca sale de la configuración", () => {
  it("en los dos rubros, y sin vocabulario (un backend anterior) es la de siempre", () => {
    for (const rubro of [automotoraDeMe("COMPLETA"), clinicaDeMe("COMPLETA")]) {
      const conOtraMarca = {
        ...rubro,
        vocabulario: { ...rubro.vocabulario!, marca: "Otra Marca" },
      };
      expect(menuDe(sesion("ADMIN", conOtraMarca)).slice(0, 2)).toEqual([
        "marca: Otra Marca",
        "marca: Otra Marca",
      ]);
    }
    const sinVocabulario = { ...clinicaDeMe("COMPLETA"), vocabulario: undefined };
    expect(menuDe(sesion("ADMIN", sinVocabulario)).slice(0, 2)).toEqual([
      "marca: Plataforma CRM",
      "marca: Plataforma CRM",
    ]);
  });
});

describe("el rol al pie del menú", () => {
  it("una automotora: Administrador y Usuario, como siempre; Recepción dice Recepción", () => {
    expect(rotuloDelRol(sesion("ADMIN", automotoraDeMe("COMPLETA")))).toBe("Administrador");
    expect(rotuloDelRol(sesion("USER", automotoraDeMe("COMPLETA")))).toBe("Usuario");
    expect(rotuloDelRol(sesion("RECEPCION", clinicaDeMe("COMPLETA")))).toBe("Recepción");
  });
});
