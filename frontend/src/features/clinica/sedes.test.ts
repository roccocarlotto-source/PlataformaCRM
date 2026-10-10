import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../auth/AuthContext";
import { sedesDeQuienEntra, sucursalesDeQuienEntra } from "./sedes";

// Usuarios por sede (docs/rubros.md §11.5, R20): qué sucursales ve quien entra.
const base = {
  id: "u",
  email: "persona@example.com",
  fullName: "Persona",
  organizationId: "o",
  isPlatformAdmin: false,
  canUseInternalAgent: false,
} as const;

const sucursales = [
  { id: "a", name: "Sede A" },
  { id: "b", name: "Sede B" },
];

describe("sedes de quien entra", () => {
  it("una automotora (sin la clave sedes) ve todas las sucursales, como siempre", () => {
    const me: MeResponse = { ...base, role: "USER", industry: "AUTOMOTORA" };
    expect(sedesDeQuienEntra(me)).toBeNull();
    expect(sucursalesDeQuienEntra(sucursales, me)).toEqual(sucursales);
  });

  it("un ADMIN de clínica ve todas", () => {
    const me: MeResponse = { ...base, role: "ADMIN", industry: "CLINICA", sedes: "todas" };
    expect(sucursalesDeQuienEntra(sucursales, me)).toEqual(sucursales);
  });

  it("una Recepción ve solo sus sedes; sin sedes, ninguna", () => {
    const conA: MeResponse = {
      ...base,
      role: "RECEPCION",
      industry: "CLINICA",
      sedes: [{ id: "a", name: "Sede A" }],
    };
    expect(sucursalesDeQuienEntra(sucursales, conA)).toEqual([{ id: "a", name: "Sede A" }]);
    const sinSedes: MeResponse = { ...conA, sedes: [] };
    expect(sedesDeQuienEntra(sinSedes)).toEqual([]);
    expect(sucursalesDeQuienEntra(sucursales, sinSedes)).toEqual([]);
  });
});
