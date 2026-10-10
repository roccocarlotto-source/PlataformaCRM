import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModuloRoute, useModulo } from "./modulos";
import { edicionDeMe, MODULOS_COMPLETA } from "../test/edicionFixtures";
import type { AuthContextValue, MeResponse } from "./AuthContext";

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("./AuthContext", () => ({ useAuth: useAuthMock }));

function conMe(extra: Partial<MeResponse>) {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role: "ADMIN",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      ...extra,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  });
}

function Mostrar({ modulo }: { modulo: string }) {
  return <span>{useModulo(modulo) ? "tiene" : "no tiene"}</span>;
}

function renderRutas(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/" element={<div>inicio</div>} />
        <Route element={<ModuloRoute modulo="empresas" />}>
          <Route path="/companies" element={<div>empresas</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("useModulo (docs/ediciones.md §7)", () => {
  it("ESENCIAL: no tiene lo que falta en me.modulos, sí lo que está", () => {
    conMe(edicionDeMe("ESENCIAL"));
    render(
      <>
        <Mostrar modulo="empresas" />
        <Mostrar modulo="contactos" />
      </>,
    );
    expect(screen.getAllByText(/tiene/).map((n) => n.textContent)).toEqual(["no tiene", "tiene"]);
  });

  it("COMPLETA tiene todo, aunque el rubro no traiga el módulo (el menú por rubro es R17)", () => {
    conMe({
      edition: "COMPLETA",
      industry: "CLINICA",
      modulos: MODULOS_COMPLETA.filter((m) => m !== "empresas"),
    });
    render(<Mostrar modulo="empresas" />);
    expect(screen.getByText("tiene")).toBeInTheDocument();
  });

  it("sin edition ni modulos (un backend anterior) tiene todo", () => {
    conMe({});
    render(<Mostrar modulo="empresas" />);
    expect(screen.getByText("tiene")).toBeInTheDocument();
  });
});

describe("ModuloRoute", () => {
  it("ESENCIAL sin el módulo: la ruta vuelve al inicio", () => {
    conMe(edicionDeMe("ESENCIAL"));
    renderRutas("/companies");
    expect(screen.getByText("inicio")).toBeInTheDocument();
    expect(screen.queryByText("empresas")).not.toBeInTheDocument();
  });

  it("COMPLETA: la ruta se muestra como siempre", () => {
    conMe(edicionDeMe("COMPLETA"));
    renderRutas("/companies");
    expect(screen.getByText("empresas")).toBeInTheDocument();
  });
});
