import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import type { AuthContextValue } from "../../auth/AuthContext";
import { ProveedorDelAsistente } from "../../asistente/ProveedorDelAsistente";
import { env } from "../../config/env";
import { server } from "../../test/msw/server";
import { PanelDelAsistente } from "../asistente/PanelDelAsistente";
import { GuiaPage } from "./GuiaPage";
import { SECCIONES } from "./secciones";
import { edicionDeMe } from "../../test/edicionFixtures";
import { automotoraDeMe, clinicaDeMe } from "../../test/rubroFixtures";

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ADMIN por defecto: los tests de edición y de rubro miran la guía entera;
// lo que oculta el rol se prueba en "GuiaPage — por rol".
function mockAuth(
  isPlatformAdmin: boolean,
  role: "ADMIN" | "USER" | "RECEPCION" = "ADMIN",
): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "Ana",
      organizationId: "org-1",
      role,
      isPlatformAdmin,
      canUseInternalAgent: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

function renderEn(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/ayuda" element={<GuiaPage />} />
        <Route path="/ayuda/:seccion" element={<GuiaPage />} />
        <Route path="/contacts" element={<p>Pantalla de contactos</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GuiaPage — índice", () => {
  it("lista todas las secciones menos Plataforma (y Taller, sin el módulo) para quien no es platform admin", () => {
    useAuthMock.mockReturnValue(mockAuth(false));
    renderEn("/ayuda");
    for (const seccion of SECCIONES) {
      const link = screen.queryByRole("link", { name: seccion.titulo });
      // Taller (docs/servicios.md §13.1): un módulo activable; sin él en /me,
      // la guía es la de siempre.
      if (seccion.soloPlataforma || seccion.slug === "servicios") expect(link).toBeNull();
      else expect(link).toHaveAttribute("href", `/ayuda/${seccion.slug}`);
    }
  });

  it("con el módulo Servicios aparece la sección Taller", () => {
    const base = mockAuth(false);
    useAuthMock.mockReturnValue({
      ...base,
      me: { ...base.me!, ...automotoraDeMe("COMPLETA"), modulos: ["servicios"] },
    });
    renderEn("/ayuda");
    expect(screen.getByRole("link", { name: "Taller" })).toHaveAttribute(
      "href",
      "/ayuda/servicios",
    );
  });

  it("un platform admin también ve Plataforma", () => {
    useAuthMock.mockReturnValue(mockAuth(true));
    renderEn("/ayuda");
    expect(screen.getByRole("link", { name: "Plataforma" })).toBeInTheDocument();
  });

  it("el buscador filtra por título y muestra 'No encontramos' si nada coincide", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth(false));
    renderEn("/ayuda");
    const buscador = screen.getByRole("searchbox", { name: "Buscar en la guía" });

    await user.type(buscador, "cupón");
    expect(screen.getByRole("link", { name: "Cupones y QR" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Stock" })).toBeNull();

    await user.clear(buscador);
    await user.type(buscador, "zzzzzz");
    expect(screen.getByText("No encontramos ese tema")).toBeInTheDocument();
  });
});

describe("GuiaPage — una sección", () => {
  it("renderiza el markdown con los encabezados ancla y el índice de la sección", () => {
    useAuthMock.mockReturnValue(mockAuth(false));
    const { container } = renderEn("/ayuda/contactos-y-consultas#ficha-de-contacto");
    expect(
      screen.getByRole("heading", { level: 1, name: "Contactos y consultas" }),
    ).toBeInTheDocument();
    expect(container.querySelector("#ficha-de-contacto")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "En esta sección" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ayuda" })).toHaveAttribute("href", "/ayuda");
  });

  it("un link interno del markdown navega con el router en vez de recargar", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(mockAuth(false));
    const { container } = renderEn("/ayuda/contactos-y-consultas");
    const link = container.querySelector('.ds-guia-prose a[href="/contacts"]');
    expect(link, "la sección Contactos linkea a /contacts").not.toBeNull();

    await user.click(link as HTMLAnchorElement);

    expect(screen.getByText("Pantalla de contactos")).toBeInTheDocument();
  });

  it("Plataforma no se muestra a quien no es platform admin, ni por URL", () => {
    useAuthMock.mockReturnValue(mockAuth(false));
    renderEn("/ayuda/plataforma");
    expect(screen.getByText("Esta sección no existe")).toBeInTheDocument();
  });

  it("un slug inexistente muestra el vacío con vuelta al índice", () => {
    useAuthMock.mockReturnValue(mockAuth(false));
    renderEn("/ayuda/no-existe");
    expect(screen.getByText("Esta sección no existe")).toBeInTheDocument();
  });
});

// Ediciones (docs/ediciones.md §9): sin los ## de módulos que la organización
// no tiene, en la sección y en su índice. COMPLETA, la guía de siempre.
describe("GuiaPage — por edición", () => {
  function conEdicion(edition: "COMPLETA" | "ESENCIAL") {
    const base = mockAuth(false);
    useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...edicionDeMe(edition) } });
  }

  it("ESENCIAL: la sección de oportunidades no muestra Cotizaciones ni Procesos de venta", () => {
    conEdicion("ESENCIAL");
    renderEn("/ayuda/oportunidades-y-procesos-de-venta");
    expect(
      screen.getByRole("heading", { level: 2, name: "Oportunidades en la edición Esencial" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Oportunidades" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Cotizaciones" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Procesos de venta" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cotizaciones" })).toBeNull();
  });

  it("ESENCIAL: el buscador no encuentra lo oculto", async () => {
    const user = userEvent.setup();
    conEdicion("ESENCIAL");
    renderEn("/ayuda");
    await user.type(screen.getByRole("searchbox", { name: "Buscar en la guía" }), "cotiza");
    expect(screen.queryByRole("link", { name: "Cotizaciones" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Crear una cotización" })).toBeNull();
    // La cotización del dólar (Organización) no es el módulo de cotizaciones.
    expect(screen.getByRole("link", { name: "Cotización vigente" })).toBeInTheDocument();
  });

  it("COMPLETA: la sección de oportunidades con Cotizaciones y Procesos de venta, como siempre", () => {
    conEdicion("COMPLETA");
    renderEn("/ayuda/oportunidades-y-procesos-de-venta");
    expect(screen.getByRole("heading", { level: 2, name: "Cotizaciones" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Procesos de venta" }),
    ).toBeInTheDocument();
  });
});

// Rubros (docs/rubros.md §1.3, R17): GuiaPage elige la guía según el rubro de
// /me. Una automotora ve la de siempre; una clínica, la de clinicas/.
describe("GuiaPage — por rubro", () => {
  function indice(rubro: Parameters<typeof automotoraDeMe>[0], esClinica: boolean) {
    const base = mockAuth(false);
    useAuthMock.mockReturnValue({
      ...base,
      me: { ...base.me!, ...(esClinica ? clinicaDeMe(rubro) : automotoraDeMe(rubro)) },
    });
    const { container, unmount } = renderEn("/ayuda");
    const titulos = [...container.querySelectorAll("a[href^='/ayuda/']")].map(
      (a) => `${a.textContent} -> ${a.getAttribute("href")}`,
    );
    unmount();
    return titulos;
  }

  it("una automotora ve exactamente el índice de antes (igual que sin rubro)", () => {
    for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
      const base = mockAuth(false);
      useAuthMock.mockReturnValue({ ...base, me: { ...base.me!, ...edicionDeMe(edition) } });
      const { container, unmount } = renderEn("/ayuda");
      const sinRubro = [...container.querySelectorAll("a[href^='/ayuda/']")].map(
        (a) => `${a.textContent} -> ${a.getAttribute("href")}`,
      );
      unmount();
      expect(indice(edition, false)).toEqual(sinRubro);
    }
  });

  it("una clínica ve sus secciones: Pacientes, Agenda y tareas, Organización y sedes; nada de stock ni oportunidades", () => {
    const titulos = indice("COMPLETA", true).join("\n");
    expect(titulos).toContain("Pacientes y consultas -> /ayuda/contactos-y-consultas");
    expect(titulos).toContain("Agenda y tareas -> /ayuda/actividades-y-agenda");
    expect(titulos).toContain("Organización y sedes -> /ayuda/organizacion-y-sucursales");
    expect(titulos).not.toMatch(/\/ayuda\/(stock|oportunidades-y-procesos-de-venta)/);
  });
});

// Roles (asistente de ayuda, P6): USER y RECEPCION no ven los bloques de
// administrador, ni las secciones que se quedan sin ninguno, ni links a
// pantallas de AdminRoute.
describe("GuiaPage — por rol", () => {
  function conRol(role: "USER" | "RECEPCION", esClinica: boolean) {
    const base = mockAuth(false, role);
    useAuthMock.mockReturnValue({
      ...base,
      me: {
        ...base.me!,
        ...(esClinica ? clinicaDeMe("COMPLETA") : automotoraDeMe("COMPLETA")),
      },
    });
  }

  it("un USER no ve las secciones de configuración en el índice", () => {
    conRol("USER", false);
    renderEn("/ayuda");
    expect(screen.queryByRole("link", { name: "Base de conocimiento" })).toBeNull();
    expect(screen.getByRole("link", { name: "Conversaciones" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Invitar a una persona" })).toBeNull();
    expect(screen.getByRole("link", { name: "Los dos roles" })).toBeInTheDocument();
  });

  it("un USER ve cómo deriva el agente pero no cómo se configura", () => {
    conRol("USER", false);
    renderEn("/ayuda/agentes-de-ia");
    expect(
      screen.getByRole("heading", { level: 2, name: "Derivar a una persona" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Instrucciones" })).toBeNull();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Instalar el chat en un sitio web" }),
    ).toBeNull();
  });

  it("un USER no tiene links a pantallas de administrador", () => {
    conRol("USER", false);
    const { container } = renderEn("/ayuda/usuarios-y-permisos");
    const hrefs = [...container.querySelectorAll("article a[href^='/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).not.toContain("/users");
    expect(hrefs).not.toContain("/invitations/new");
  });

  it("Recepción no ve Organización y sedes, y sí la agenda", () => {
    conRol("RECEPCION", true);
    renderEn("/ayuda");
    expect(screen.queryByRole("link", { name: "Organización y sedes" })).toBeNull();
    expect(screen.getByRole("link", { name: "Agenda y tareas" })).toBeInTheDocument();
  });
});

// La caja del asistente "¿Cómo se hace?" arriba del buscador: solo con el
// asistente prendido; la pregunta abre el panel y sale enseguida.
describe("GuiaPage — la caja de ¿Cómo se hace?", () => {
  function renderConAsistente(disponible: boolean) {
    useAuthMock.mockReturnValue(mockAuth(false));
    return render(
      <MemoryRouter initialEntries={["/ayuda"]}>
        <ProveedorDelAsistente disponible={disponible}>
          <Routes>
            <Route path="/ayuda" element={<GuiaPage />} />
          </Routes>
          <PanelDelAsistente contactosEnPlural="clientes" />
        </ProveedorDelAsistente>
      </MemoryRouter>,
    );
  }

  it("sin el asistente no está", () => {
    renderConAsistente(false);
    expect(screen.queryByLabelText("Preguntá cómo hacer algo")).not.toBeInTheDocument();
  });

  it("la pregunta abre el panel y sale con la pantalla Ayuda como contexto", async () => {
    const cuerpos: unknown[] = [];
    server.use(
      http.post(`${env.apiUrl}/api/help-assistant/questions`, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json({
          id: "q-1",
          respuesta: "Así se hace.",
          fuentes: [],
          tipo: "ANSWERED",
          restantesHoy: 19,
        });
      }),
    );
    const user = userEvent.setup();
    renderConAsistente(true);
    await user.type(screen.getByLabelText("Preguntá cómo hacer algo"), "¿Cómo invito a alguien?");
    await user.click(screen.getByRole("button", { name: "Preguntar" }));
    expect(await screen.findByText("Así se hace.")).toBeInTheDocument();
    expect(cuerpos).toEqual([{ pregunta: "¿Cómo invito a alguien?", pantalla: "ayuda" }]);
  });
});
