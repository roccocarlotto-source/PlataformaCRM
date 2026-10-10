import { describe, expect, it } from "vitest";
import { puedeAtender } from "../features/conversation/permissions";
import type { RoleName } from "./AuthContext";
import { puedeEditarContacto, puedeEditarRegistro } from "./permisos";

// Las reglas que el frontend repite solo para decidir qué botones mostrar
// (el backend las vuelve a decidir: src/services/permisos.ts). ADMIN y USER,
// las de siempre; Recepción (R12, docs/rubros.md §11.2) edita cualquier
// contacto y atiende cualquier conversación.
const yo = (role: RoleName) => ({ id: "yo", role });

describe("permisos del frontend por rol", () => {
  it("editar un contacto ajeno: ADMIN y Recepción sí, USER no; lo propio, todos", () => {
    const ajeno = { ownerId: "otra" };
    const propio = { ownerId: "yo" };
    expect(puedeEditarContacto(yo("ADMIN"), ajeno)).toBe(true);
    expect(puedeEditarContacto(yo("RECEPCION"), ajeno)).toBe(true);
    expect(puedeEditarContacto(yo("USER"), ajeno)).toBe(false);
    for (const role of ["ADMIN", "USER", "RECEPCION"] as const) {
      expect(puedeEditarContacto(yo(role), propio)).toBe(true);
    }
  });

  it("una oportunidad ajena la edita solo un ADMIN (Recepción, como un USER)", () => {
    const ajena = { ownerId: "otra" };
    expect(puedeEditarRegistro(yo("ADMIN"), ajena)).toBe(true);
    expect(puedeEditarRegistro(yo("RECEPCION"), ajena)).toBe(false);
    expect(puedeEditarRegistro(yo("USER"), ajena)).toBe(false);
  });

  it("atender una conversación asignada a otra persona: ADMIN y Recepción sí, USER no", () => {
    const ajena = { assignedUserId: "otra" };
    expect(puedeAtender(yo("ADMIN"), ajena)).toBe(true);
    expect(puedeAtender(yo("RECEPCION"), ajena)).toBe(true);
    expect(puedeAtender(yo("USER"), ajena)).toBe(false);
    expect(puedeAtender(yo("USER"), { assignedUserId: "yo" })).toBe(true);
  });
});
