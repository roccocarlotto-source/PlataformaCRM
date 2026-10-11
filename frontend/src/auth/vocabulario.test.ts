import { describe, expect, it } from "vitest";
import type { MeResponse } from "./AuthContext";
import {
  concordancia,
  marcaDe,
  VOCABULARIO_AUTOMOTORA_POR_DEFECTO,
  VOCABULARIO_DE_CLINICA_POR_DEFECTO,
  vocabularioDe,
} from "./vocabulario";
import { VOCABULARIO_AUTOMOTORA_DE_ME, VOCABULARIO_CLINICA_DE_ME } from "../test/rubroFixtures";

const BASE: MeResponse = {
  id: "u1",
  email: "persona@example.com",
  fullName: "Ana Pérez",
  organizationId: "org-1",
  role: "ADMIN",
  isPlatformAdmin: false,
  canUseInternalAgent: false,
};

describe("vocabularioDe (docs/rubros.md §3)", () => {
  it("con el vocabulario de /me, es ese, término por término", () => {
    expect(vocabularioDe({ ...BASE, vocabulario: VOCABULARIO_AUTOMOTORA_DE_ME })).toEqual(
      VOCABULARIO_AUTOMOTORA_DE_ME,
    );
    expect(
      vocabularioDe({ ...BASE, industry: "CLINICA", vocabulario: VOCABULARIO_CLINICA_DE_ME }),
    ).toEqual(VOCABULARIO_CLINICA_DE_ME);
  });

  it("los defaults del frontend son los mismos que manda el backend", () => {
    expect(VOCABULARIO_AUTOMOTORA_POR_DEFECTO).toEqual(VOCABULARIO_AUTOMOTORA_DE_ME);
    expect(VOCABULARIO_DE_CLINICA_POR_DEFECTO).toEqual(VOCABULARIO_CLINICA_DE_ME);
  });

  it("sin vocabulario (un backend anterior), el del rubro; sin rubro, el de una automotora", () => {
    expect(vocabularioDe(null)).toBe(VOCABULARIO_AUTOMOTORA_POR_DEFECTO);
    expect(vocabularioDe(BASE)).toBe(VOCABULARIO_AUTOMOTORA_POR_DEFECTO);
    expect(vocabularioDe({ ...BASE, industry: "CLINICA" })).toBe(
      VOCABULARIO_DE_CLINICA_POR_DEFECTO,
    );
  });

  it("un /me de antes de R17b (sin sucursal ni género) se completa con el del rubro", () => {
    const sinGenero = Object.fromEntries(
      Object.entries(VOCABULARIO_CLINICA_DE_ME)
        .filter(([clave]) => clave !== "sucursal")
        .map(([clave, valor]) => {
          if (typeof valor === "string") return [clave, valor];
          const resto: Partial<typeof valor> = { ...valor };
          delete resto.genero;
          return [clave, resto];
        }),
    ) as unknown as MeResponse["vocabulario"];
    const v = vocabularioDe({ ...BASE, industry: "CLINICA", vocabulario: sinGenero });
    expect(v.sucursal.pluralTitulo).toBe("Sedes");
    expect(v.reserva.genero).toBe("masculino");
    expect(v.agenda.genero).toBe("femenino");
    expect(v.contacto.pluralTitulo).toBe("Pacientes");
  });

  it("la marca sale del vocabulario", () => {
    expect(marcaDe(null)).toBe("Plataforma CRM");
    expect(
      marcaDe({ ...BASE, vocabulario: { ...VOCABULARIO_AUTOMOTORA_DE_ME, marca: "Otra Marca" } }),
    ).toBe("Otra Marca");
  });
});

describe("concordancia", () => {
  it("artículos y adjetivos según el género del término", () => {
    const automotora = VOCABULARIO_AUTOMOTORA_POR_DEFECTO;
    const clinica = VOCABULARIO_DE_CLINICA_POR_DEFECTO;
    expect(`${concordancia(automotora.reserva).el} ${automotora.reserva.singular}`).toBe(
      "la reserva",
    );
    expect(`${concordancia(clinica.reserva).el} ${clinica.reserva.singular}`).toBe("el turno");
    expect(`${concordancia(clinica.tipoDeServicio).Nuevo} ${clinica.tipoDeServicio.singular}`).toBe(
      "Nueva prestación",
    );
    expect(`${concordancia(automotora.recurso).Este} ${automotora.recurso.singular}`).toBe(
      "Este recurso",
    );
    expect(`${concordancia(clinica.sucursal).del} ${clinica.sucursal.singular}`).toBe("de la sede");
  });
});
