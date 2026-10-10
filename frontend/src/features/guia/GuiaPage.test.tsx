import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthContextValue } from "../../auth/AuthContext";
import { GuiaPage } from "./GuiaPage";
import { SECCIONES } from "./secciones";
import { edicionDeMe } from "../../test/edicionFixtures";

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(isPlatformAdmin: boolean): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "Ana",
      organizationId: "org-1",
      role: "USER",
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
  it("lista todas las secciones menos Plataforma para quien no es platform admin", () => {
    useAuthMock.mockReturnValue(mockAuth(false));
    renderEn("/ayuda");
    for (const seccion of SECCIONES) {
      const link = screen.queryByRole("link", { name: seccion.titulo });
      if (seccion.soloPlataforma) expect(link).toBeNull();
      else expect(link).toHaveAttribute("href", `/ayuda/${seccion.slug}`);
    }
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
    expect(screen.getByRole("heading", { level: 2, name: "Oportunidades" })).toBeInTheDocument();
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
