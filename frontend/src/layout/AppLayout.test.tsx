import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { env } from "../config/env";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { ThemeProvider } from "../theme/ThemeContext";
import type { AuthContextValue } from "../auth/AuthContext";
import { edicionDeMe } from "../test/edicionFixtures";

// Primer test de componente propio de AppLayout (gap heredado desde M2,
// ver M6 informe de deuda técnica) — se agrega ahora porque M7 introduce
// la primera rama de comportamiento condicional por rol en el nav
// (Usuarios/Invitaciones), que antes no existía.
vi.mock("../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

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

// ThemeProvider REAL (no mock): el toggle de tema del pie de la sidebar (§31)
// necesita el contexto, y el provider no tiene dependencias externas — con el
// matchMedia de test/setup.ts (que no prefiere oscuro) resuelve "Sistema" a
// claro, y localStorage arranca vacío.
// Con Routes de verdad (y no AppLayout suelto) para que los links de la
// sidebar naveguen y el pathname cambie: de eso depende qué sección arranca
// desplegada (ítem 79). `outlet` es lo que se renderiza en el <Outlet />.
function renderLayout(initialPath = "/", outlet: ReactNode = null) {
  // El menú pregunta las ediciones disponibles si es platform admin
  // (docs/ediciones.md §7): hace falta un QueryClient.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={outlet} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// Secciones colapsables (ítem 79): plegadas, sus hijos quedan montados pero
// `inert` (ítem 80, para poder animar el despliegue) — no se pueden tocar ni
// tabular, así que cada test abre la sección antes de usar sus links — mismo
// userEvent + click que MultiSelect.test.tsx para abrir la lista.
type User = ReturnType<typeof userEvent.setup>;

async function openSection(user: User, name: string) {
  await user.click(screen.getByRole("button", { name }));
}

// Contactos es link a /contacts Y sub-desplegable dentro de CRM.
async function openContactos(user: User) {
  await openSection(user, "CRM");
  await user.click(screen.getByRole("link", { name: "Contactos" }));
}

describe("AppLayout — nav gateado por rol (M7)", () => {
  it("ADMIN ve los links de Usuarios e Invitaciones", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Invitaciones")).toBeInTheDocument();
  });

  it("USER no ve los links de Usuarios ni Invitaciones", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(screen.queryByText("Invitaciones")).not.toBeInTheDocument();
  });

  it("la navegación existente (Empresas/Contactos/Procesos de venta/Oportunidades) sigue intacta para ambos roles", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    await openContactos(user);

    expect(screen.getByText("Empresas")).toBeInTheDocument();
    expect(screen.getByText("Contactos")).toBeInTheDocument();
    expect(screen.getByText("Procesos de venta")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
  });

  it("'Mis tareas' se muestra para ambos roles: leer y completar lo propio es de cualquier rol", async () => {
    for (const role of ["USER", "ADMIN"] as const) {
      const user = userEvent.setup();
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = renderLayout();
      await openSection(user, "Actividades");
      expect(screen.getByText("Mis tareas")).toHaveAttribute("href", "/tasks");
      unmount();
    }
  });

  it("muestra el nombre del usuario autenticado", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("AppLayout — nav de Actividades (ítem 25)", () => {
  it("ADMIN ve 'Actividades' en la sección Actividades, apuntando a /activities", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await openSection(user, "Actividades");

    expect(screen.getByRole("link", { name: "Actividades" })).toHaveAttribute(
      "href",
      "/activities",
    );
  });

  it("USER no ve el link 'Actividades': el listado completo es ADMIN-only, lo suyo lo ve en 'Mis tareas'", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    // El título de la sección también dice "Actividades" (ítem 79), pero es
    // un botón: lo que no tiene que existir es el LINK.
    await openSection(user, "Actividades");

    expect(screen.queryByRole("link", { name: "Actividades" })).not.toBeInTheDocument();
    expect(screen.getByText("Mis tareas")).toHaveAttribute("href", "/tasks");
  });
});

describe("AppLayout — nav de configuración de la organización (ítem 19)", () => {
  it("ADMIN ve 'Organización' en el grupo Administración, apuntando a /organization", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.getByRole("link", { name: "Organización" })).toHaveAttribute(
      "href",
      "/organization",
    );
  });

  it("USER no ve 'Organización': la pantalla es toda escritura ADMIN-only", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.queryByText("Organización")).not.toBeInTheDocument();
  });
});

describe("AppLayout — Plantillas de WhatsApp ya no está en el menú", () => {
  it("ni un ADMIN la ve: el mensaje se configura en la regla de automatización", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.queryByText("Plantillas de WhatsApp")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav de Sucursales (ítem 20)", () => {
  it("ADMIN ve 'Sucursales' en el grupo Administración, apuntando a /branches", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.getByRole("link", { name: "Sucursales" })).toHaveAttribute("href", "/branches");
  });

  it("USER no ve 'Sucursales': la pantalla es toda escritura ADMIN-only", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    await openSection(user, "Administración");

    expect(screen.queryByText("Sucursales")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav de Agentes de IA (ítem 55)", () => {
  it("ADMIN ve 'Agentes de IA' como título de su sección, apuntando a /agents", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    expect(screen.getByRole("link", { name: "Agentes de IA" })).toHaveAttribute("href", "/agents");
  });

  it("USER no ve 'Agentes de IA': el módulo entero es configuración ADMIN-only", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();

    expect(screen.queryByText("Agentes de IA")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav de Base de conocimiento (ítem 59)", () => {
  it("ADMIN ve 'Base de conocimiento' dentro de Agentes de IA, apuntando a /knowledge-base", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await user.click(screen.getByRole("link", { name: "Agentes de IA" }));

    const link = screen.getByRole("link", { name: "Base de conocimiento" });
    expect(link).toHaveAttribute("href", "/knowledge-base");
    // En el mismo grupo que Agentes de IA, que es el módulo que consume estas
    // entradas.
    expect(link.closest(".ds-sidebar-group")).toBe(
      screen.getByRole("link", { name: "Agentes de IA" }).closest(".ds-sidebar-group"),
    );
  });

  it("USER no ve 'Base de conocimiento': la pantalla es toda configuración ADMIN-only", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();

    expect(screen.queryByText("Base de conocimiento")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav de Automatizaciones (ítem 62)", () => {
  it("ADMIN ve 'Automatizaciones' en el mismo grupo que Agentes de IA, apuntando a /automations", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();
    await user.click(screen.getByRole("link", { name: "Agentes de IA" }));

    const link = screen.getByRole("link", { name: "Automatizaciones" });
    expect(link).toHaveAttribute("href", "/automations");
    expect(link.closest(".ds-sidebar-group")).toBe(
      screen.getByRole("link", { name: "Agentes de IA" }).closest(".ds-sidebar-group"),
    );
  });

  it("USER no ve 'Automatizaciones': la pantalla es toda configuración ADMIN-only", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();

    expect(screen.queryByText("Automatizaciones")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav de Conversaciones (ítem 66)", () => {
  it("el link se muestra para ambos roles, en el grupo CRM y debajo de Contactos", async () => {
    for (const role of ["USER", "ADMIN"] as const) {
      const user = userEvent.setup();
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = renderLayout();
      await openContactos(user);

      const link = screen.getByRole("link", { name: "Conversaciones" });
      expect(link).toHaveAttribute("href", "/conversations");
      // En el grupo CRM y no en Administración: es lectura de un dato del
      // CRM, no configuración ADMIN-only como Agentes de IA.
      expect(link.closest(".ds-sidebar-group")).toBe(
        screen.getByRole("link", { name: "Contactos" }).closest(".ds-sidebar-group"),
      );
      unmount();
    }
  });
});

describe("AppLayout — nav del módulo QR (Fase 3)", () => {
  it("el link QR se muestra para ambos roles: el listado es de lectura abierta", async () => {
    for (const role of ["USER", "ADMIN"] as const) {
      const user = userEvent.setup();
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = renderLayout();
      await openSection(user, "Administración");
      expect(screen.getByRole("link", { name: "QR" })).toHaveAttribute("href", "/qr");
      unmount();
    }
  });
});

describe("AppLayout — secciones colapsables (ítem 79)", () => {
  function isExpanded(element: HTMLElement) {
    return element.getAttribute("aria-expanded") === "true";
  }

  // Desde el ítem 80 los hijos de una sección plegada siguen en el DOM (para
  // animar el alto) y la garantía es `inert`: fuera del tab order y del árbol
  // de accesibilidad. jsdom no implementa ese efecto, así que se afirma el
  // atributo en un ancestro — con la sección anidada (Contactos dentro de
  // CRM) alcanza con que CUALQUIER ancestro lo tenga, como en el navegador.
  function expectFolded(name: string) {
    expect(screen.getByRole("link", { name }).closest("[inert]")).not.toBeNull();
  }

  function expectUnfolded(name: string) {
    expect(screen.getByRole("link", { name }).closest("[inert]")).toBeNull();
  }

  it("en el Dashboard todas las secciones arrancan plegadas y sus hijos quedan inert", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/");

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    for (const name of ["CRM", "Actividades", "Administración"]) {
      expect(isExpanded(screen.getByRole("button", { name }))).toBe(false);
    }
    expect(isExpanded(screen.getByRole("link", { name: "Agentes de IA" }))).toBe(false);
    for (const name of ["Contactos", "Stock", "Mis tareas", "QR", "Base de conocimiento"]) {
      expectFolded(name);
    }
  });

  it("el título-toggle despliega y vuelve a plegar su sección, sin navegar", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout("/");
    const crm = screen.getByRole("button", { name: "CRM" });

    await user.click(crm);
    expect(isExpanded(crm)).toBe(true);
    expect(screen.getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/vehicles");
    expectUnfolded("Stock");
    // Contactos es un sub-desplegable propio: abrir CRM no lo abre.
    expect(isExpanded(screen.getByRole("link", { name: "Contactos" }))).toBe(false);
    expectFolded("Empresas");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("is-active");

    await user.click(crm);
    expect(isExpanded(crm)).toBe(false);
    expectFolded("Stock");
  });

  it("'Contactos' navega a /contacts Y pliega/despliega con el mismo click", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout("/");
    await openSection(user, "CRM");

    await user.click(screen.getByRole("link", { name: "Contactos" }));
    const contactos = screen.getByRole("link", { name: "Contactos" });
    expect(contactos).toHaveClass("is-active");
    expect(isExpanded(contactos)).toBe(true);
    expect(screen.getByRole("link", { name: "Empresas" })).toHaveAttribute("href", "/companies");
    expectUnfolded("Empresas");

    await user.click(contactos);
    expect(isExpanded(contactos)).toBe(false);
    expectFolded("Empresas");
  });

  it("'Agentes de IA' navega a /agents Y pliega/despliega con el mismo click", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/");

    await user.click(screen.getByRole("link", { name: "Agentes de IA" }));
    const agentes = screen.getByRole("link", { name: "Agentes de IA" });
    expect(agentes).toHaveClass("is-active");
    expect(isExpanded(agentes)).toBe(true);
    expectUnfolded("Automatizaciones");

    await user.click(agentes);
    expect(isExpanded(agentes)).toBe(false);
    expectFolded("Automatizaciones");
  });

  it("con la ruta activa adentro, esa sección (y Contactos si aplica) arranca desplegada y el resto no", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/companies");

    expect(isExpanded(screen.getByRole("button", { name: "CRM" }))).toBe(true);
    expect(isExpanded(screen.getByRole("link", { name: "Contactos" }))).toBe(true);
    expect(screen.getByRole("link", { name: "Empresas" })).toHaveClass("is-active");
    expect(isExpanded(screen.getByRole("button", { name: "Actividades" }))).toBe(false);
    expect(isExpanded(screen.getByRole("button", { name: "Administración" }))).toBe(false);
    expect(isExpanded(screen.getByRole("link", { name: "Agentes de IA" }))).toBe(false);
  });

  it.each([
    ["/pipelines", "CRM", "Procesos de venta"],
    ["/service-types", "Actividades", "Tipos de servicio"],
    ["/branches", "Administración", "Sucursales"],
  ])("en %s arranca desplegada %s", (path, section, child) => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout(path);

    expect(isExpanded(screen.getByRole("button", { name: section }))).toBe(true);
    expect(screen.getByRole("link", { name: child })).toHaveClass("is-active");
  });

  it("en una subruta de un hijo (/automations/...) arranca desplegada Agentes de IA", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/automations/new");

    expect(isExpanded(screen.getByRole("link", { name: "Agentes de IA" }))).toBe(true);
    expect(screen.getByRole("link", { name: "Automatizaciones" })).toHaveClass("is-active");
  });

  it("navegar hacia adentro de una sección plegada desde el contenido la despliega", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/", <Link to="/automations">ir a automatizaciones</Link>);
    expectFolded("Automatizaciones");

    await user.click(screen.getByRole("link", { name: "ir a automatizaciones" }));

    expect(isExpanded(screen.getByRole("link", { name: "Agentes de IA" }))).toBe(true);
    expect(screen.getByRole("link", { name: "Automatizaciones" })).toHaveClass("is-active");
    expectUnfolded("Automatizaciones");
  });

  it("plegar a mano la sección donde uno está parado se respeta", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout("/tasks");
    const actividades = screen.getByRole("button", { name: "Actividades" });
    expect(isExpanded(actividades)).toBe(true);

    await user.click(actividades);

    expect(isExpanded(actividades)).toBe(false);
    expectFolded("Mis tareas");
  });

  it("un USER ve la sección Administración con QR como único link (no pierde el QR que ya tenía)", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout("/");
    const admin = screen.getByRole("button", { name: "Administración" });

    await user.click(admin);

    const section = admin.closest(".ds-sidebar-group") as HTMLElement;
    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["QR"]);
  });

  it("un ADMIN ve los 9 links de Administración, QR primero", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/");
    const admin = screen.getByRole("button", { name: "Administración" });

    await user.click(admin);

    const section = admin.closest(".ds-sidebar-group") as HTMLElement;
    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "QR",
      "Usuarios",
      "Invitaciones",
      "Fuentes de ingesta",
      "Claves de ingesta",
      "Eventos de ingesta",
      "Organización",
      "Sucursales",
      "Campos de contacto",
    ]);
  });

  it("la sección Actividades fusiona Actividad y Agenda, cada link con su permiso", async () => {
    const expected = {
      ADMIN: [
        "Actividades",
        "Mis tareas",
        "Reservas",
        "Calendario",
        "Recursos",
        "Tipos de servicio",
      ],
      USER: ["Mis tareas", "Reservas", "Calendario"],
    };
    for (const role of ["USER", "ADMIN"] as const) {
      const user = userEvent.setup();
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = renderLayout("/");
      const actividades = screen.getByRole("button", { name: "Actividades" });
      await user.click(actividades);

      const section = actividades.closest(".ds-sidebar-group") as HTMLElement;
      expect(
        within(section)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(expected[role]);
      unmount();
    }
  });
});

describe("AppLayout — nav de platform admin (Fase 4a del módulo SaaS)", () => {
  function mockPlatformAdmin(role: "ADMIN" | "USER"): AuthContextValue {
    const base = mockAuth(role);
    return { ...base, me: { ...base.me!, isPlatformAdmin: true } };
  }

  const editionsUrl = `${env.apiUrl}/api/admin/organizations/editions`;
  // Por defecto, un backend que ofrece solo COMPLETA (ESENCIAL_HABILITADA en
  // false); los casos de ESENCIAL lo cambian.
  beforeEach(() => {
    server.use(http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA"] })));
  });

  it("'Organizaciones' no aparece mientras el backend no ofrezca ESENCIAL", async () => {
    let pidio = false;
    server.use(
      http.get(editionsUrl, () => {
        pidio = true;
        return HttpResponse.json({ editions: ["COMPLETA"] });
      }),
    );
    useAuthMock.mockReturnValue(mockPlatformAdmin("ADMIN"));
    renderLayout();

    await waitFor(() => expect(pidio).toBe(true));
    expect(screen.getByRole("link", { name: "Nueva organización" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Organizaciones" })).not.toBeInTheDocument();
  });

  it("'Organizaciones' aparece cuando el backend ofrece ESENCIAL", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
    );
    useAuthMock.mockReturnValue(mockPlatformAdmin("ADMIN"));
    renderLayout();

    expect(await screen.findByRole("link", { name: "Organizaciones" })).toHaveAttribute(
      "href",
      "/admin/organizations",
    );
  });

  it("en Nueva organización, solo ese link queda marcado (no también Organizaciones)", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
    );
    useAuthMock.mockReturnValue(mockPlatformAdmin("ADMIN"));
    renderLayout("/admin/organizations/new");

    const organizaciones = await screen.findByRole("link", { name: "Organizaciones" });
    expect(screen.getByRole("link", { name: "Nueva organización" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(organizaciones).not.toHaveAttribute("aria-current");
  });

  it("quien no es platform admin no pregunta las ediciones", async () => {
    let pidio = false;
    server.use(
      http.get(editionsUrl, () => {
        pidio = true;
        return HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] });
      }),
    );
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    await new Promise((r) => setTimeout(r, 50));
    expect(pidio).toBe(false);
    expect(screen.queryByRole("link", { name: "Organizaciones" })).not.toBeInTheDocument();
  });

  it("un platform admin ve 'Nueva organización', aunque su rol en su organización sea USER", () => {
    useAuthMock.mockReturnValue(mockPlatformAdmin("USER"));
    renderLayout();

    expect(screen.getByRole("link", { name: "Nueva organización" })).toHaveAttribute(
      "href",
      "/admin/organizations/new",
    );
    // Desde el 02/10/2026 es donde se conecta la página de Facebook de cada
    // organización.
    expect(screen.getByRole("link", { name: "Página de Facebook" })).toHaveAttribute(
      "href",
      "/admin/agents/facebook-page",
    );
  });

  it("un ADMIN de organización que no es platform admin NO ve 'Nueva organización'", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    expect(screen.queryByText("Nueva organización")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Página de Facebook" })).not.toBeInTheDocument();
  });
});

describe("AppLayout — menú del celular", () => {
  // jsdom no aplica el CSS: lo que se prueba es el estado (aria-expanded y la
  // clase del shell que el @media usa para mostrar el panel), no el panel.
  function menu() {
    return screen.getByRole("button", { name: /menú$/ });
  }

  it("la hamburguesa abre el menú, pasa el foco al primer link y lo vuelve a cerrar", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const { container } = renderLayout("/");

    expect(menu()).toHaveAttribute("aria-expanded", "false");
    await user.click(menu());

    expect(menu()).toHaveAttribute("aria-expanded", "true");
    expect(menu()).toHaveAccessibleName("Cerrar menú");
    expect(container.querySelector(".ds-shell")).toHaveClass("is-nav-open");
    expect(document.getElementById(menu().getAttribute("aria-controls") ?? "")).toContainElement(
      document.activeElement as HTMLElement,
    );

    await user.click(menu());
    expect(menu()).toHaveAttribute("aria-expanded", "false");
  });

  it("navegar desde el menú lo cierra", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/");

    await user.click(menu());
    await user.click(screen.getByRole("link", { name: "Canjear cupón" }));

    expect(menu()).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape lo cierra y devuelve el foco a la hamburguesa", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout("/");

    await user.click(menu());
    await user.keyboard("{Escape}");

    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(menu()).toHaveFocus();
  });
});

describe("AppLayout — link al escáner de cupones (ítem 178)", () => {
  it.each(["ADMIN", "USER"] as const)("un %s lo ve: el canje no restringe por rol", (role) => {
    useAuthMock.mockReturnValue(mockAuth(role));
    renderLayout();

    expect(screen.getByRole("link", { name: "Canjear cupón" })).toHaveAttribute(
      "href",
      "/vouchers/scan",
    );
  });
});

describe("AppLayout — link al agente interno (ítem 180)", () => {
  function conAcceso(role: "ADMIN" | "USER", canUseInternalAgent: boolean): AuthContextValue {
    const base = mockAuth(role);
    return { ...base, me: { ...base.me!, canUseInternalAgent } };
  }

  it("un ADMIN lo ve siempre, aunque /me dijera false", () => {
    useAuthMock.mockReturnValue(conAcceso("ADMIN", false));
    renderLayout();

    expect(screen.getByRole("link", { name: "Agente interno" })).toHaveAttribute(
      "href",
      "/internal-agent",
    );
  });

  it("un USER habilitado lo ve", () => {
    useAuthMock.mockReturnValue(conAcceso("USER", true));
    renderLayout();

    expect(screen.getByRole("link", { name: "Agente interno" })).toHaveAttribute(
      "href",
      "/internal-agent",
    );
    // Sin exponerle la configuración ni el resto de "Agentes de IA".
    expect(screen.queryByText("Configurar agente interno")).not.toBeInTheDocument();
    expect(screen.queryByText("Agentes de IA")).not.toBeInTheDocument();
  });

  it("un USER sin habilitar no lo ve", () => {
    useAuthMock.mockReturnValue(conAcceso("USER", false));
    renderLayout();

    expect(screen.queryByRole("link", { name: "Agente interno" })).not.toBeInTheDocument();
  });

  it("un ADMIN ve 'Configurar agente interno' dentro de Agentes de IA", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(conAcceso("ADMIN", true));
    renderLayout();

    await user.click(screen.getByRole("link", { name: "Agentes de IA" }));
    expect(screen.getByRole("link", { name: "Configurar agente interno" })).toHaveAttribute(
      "href",
      "/internal-agent/settings",
    );
  });
});

describe("AppLayout — selector de tema en el pie de la sidebar (ítem 31)", () => {
  it("el grupo 'Tema' con Sistema/Claro/Oscuro está dentro de .ds-sidebar-account, ANTES de la identidad y de 'Cerrar sesión'", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const { container } = renderLayout();

    const group = screen.getByRole("group", { name: "Tema" });
    const account = container.querySelector(".ds-sidebar-account");
    expect(account).not.toBeNull();
    expect(account).toContainElement(group);
    for (const name of ["Sistema", "Claro", "Oscuro"]) {
      expect(group).toContainElement(screen.getByRole("button", { name }));
    }

    // Orden dentro del bloque: toggle → nombre/rol → Cerrar sesión.
    const logout = screen.getByRole("button", { name: "Cerrar sesión" });
    const identity = screen.getByText("Usuario");
    expect(group.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      identity.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sin preferencia guardada arranca en 'Sistema', para ambos roles", () => {
    for (const role of ["USER", "ADMIN"] as const) {
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = renderLayout();
      expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      unmount();
    }
  });
});

// Rubros (docs/rubros.md §4.3, R5): una automotora ve Recursos y Tipos de
// servicio, como siempre. El menú de una clínica está en menuPorRubro.test.tsx.
describe("AppLayout — agenda por rubro (R5)", () => {
  it("una automotora (sin industry o AUTOMOTORA) ve Recursos y Tipos de servicio, y nada de clínica", async () => {
    for (const industry of [undefined, "AUTOMOTORA" as const]) {
      const user = userEvent.setup();
      const auth = mockAuth("ADMIN");
      useAuthMock.mockReturnValue({ ...auth, me: { ...auth.me!, industry } });
      const { unmount } = renderLayout();
      await openSection(user, "Actividades");
      expect(screen.getByRole("link", { name: "Recursos" })).toHaveAttribute("href", "/resources");
      expect(screen.getByRole("link", { name: "Tipos de servicio" })).toHaveAttribute(
        "href",
        "/service-types",
      );
      expect(screen.queryByRole("link", { name: "Profesionales" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Prestaciones" })).not.toBeInTheDocument();
      unmount();
    }
  });
});

// Ediciones (docs/ediciones.md §7, paso E1): sin el módulo, el link no aparece.
describe("AppLayout — menú por edición", () => {
  function conEdicion(edition: "COMPLETA" | "ESENCIAL") {
    const base = mockAuth("ADMIN");
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...edicionDeMe(edition) } });
  }

  it("ESENCIAL: sin Empresas ni Procesos de venta; Contactos, Oportunidades y Stock siguen", async () => {
    const user = userEvent.setup();
    conEdicion("ESENCIAL");
    renderLayout();
    await openContactos(user);

    expect(screen.queryByText("Empresas")).not.toBeInTheDocument();
    expect(screen.queryByText("Procesos de venta")).not.toBeInTheDocument();
    expect(screen.getByText("Contactos")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
    expect(screen.getByText("Stock")).toBeInTheDocument();
  });

  it("COMPLETA: Empresas y Procesos de venta como siempre", async () => {
    const user = userEvent.setup();
    conEdicion("COMPLETA");
    renderLayout();
    await openContactos(user);

    expect(screen.getByRole("link", { name: "Empresas" })).toHaveAttribute("href", "/companies");
    expect(screen.getByRole("link", { name: "Procesos de venta" })).toHaveAttribute(
      "href",
      "/pipelines",
    );
  });
});
