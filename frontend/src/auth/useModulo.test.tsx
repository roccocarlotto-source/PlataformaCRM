import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModuloRoute } from "./ModuloRoute";
import { tieneModulo, useModulo } from "./useModulo";
import { edicionDeMe } from "../test/edicionFixtures";
import { automotoraDeMe, clinicaDeMe } from "../test/rubroFixtures";
import { MODULO_DE_ANCLA, SOLO_SIN_MODULO } from "../features/guia/secciones";
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

  it("COMPLETA también lee me.modulos: una clínica no tiene empresas (R17)", () => {
    conMe(clinicaDeMe("COMPLETA"));
    render(
      <>
        <Mostrar modulo="empresas" />
        <Mostrar modulo="stock" />
        <Mostrar modulo="oportunidades" />
        <Mostrar modulo="contactos" />
      </>,
    );
    expect(screen.getAllByText(/tiene/).map((n) => n.textContent)).toEqual([
      "no tiene",
      "no tiene",
      "no tiene",
      "tiene",
    ]);
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

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (docs/rubros.md §14.1): R17 hizo que
// tieneModulo lea `modulos` también en COMPLETA. Para una automotora da lo
// mismo que la regla de antes en TODOS los módulos que el frontend pregunta:
// se buscan en el código (useModulo, tieneModulo, ModuloRoute y
// modulos.includes) más los de la guía de uso.
// ---------------------------------------------------------------------------

const FUENTES = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PREGUNTA_POR_MODULO = [
  /useModulo\("([a-z_]+)"\)/g,
  /tieneModulo\([^,()]+,\s*"([a-z_]+)"\)/g,
  /modulo="([a-z_]+)"/g,
  /modulos\.includes\("([a-z_]+)"\)/g,
];

function modulosQuePreguntaElFrontend(): Set<string> {
  const modulos = new Set<string>([
    ...Object.values(MODULO_DE_ANCLA),
    ...Object.values(SOLO_SIN_MODULO),
  ]);
  for (const fuente of Object.values(FUENTES)) {
    for (const re of PREGUNTA_POR_MODULO) {
      for (const match of fuente.matchAll(re)) modulos.add(match[1]);
    }
  }
  return modulos;
}

/** La regla de antes de R17: filtraba solo en ESENCIAL. */
function reglaAnterior(me: MeResponse, modulo: string): boolean {
  if (me.edition !== "ESENCIAL" || me.modulos === undefined) return true;
  return me.modulos.includes(modulo);
}

describe("automotora sin cambios: tieneModulo en las dos ediciones", () => {
  const preguntados = modulosQuePreguntaElFrontend();

  it("encuentra los módulos que el frontend pregunta", () => {
    for (const modulo of ["empresas", "procesos_de_venta", "stock", "oportunidades", "permutas"]) {
      expect(preguntados.has(modulo), modulo).toBe(true);
    }
  });

  it("para una automotora da lo mismo que antes, en cada módulo y en las dos ediciones", () => {
    for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
      for (const rubro of [automotoraDeMe(edition), edicionDeMe(edition)]) {
        const me = { id: "u1", role: "ADMIN", ...rubro } as MeResponse;
        for (const modulo of preguntados) {
          expect(tieneModulo(me, modulo), `${edition} ${modulo}`).toBe(reglaAnterior(me, modulo));
        }
      }
    }
  });
});
