import { vi } from "vitest";
import type { AuthContextValue, MeResponse, RoleName } from "../auth/AuthContext";
import { automotoraDeMe } from "./rubroFixtures";

/** Una sesión autenticada para el mock de useAuth, con los campos de rubro y
 *  edición de `me` (automotoraDeMe / clinicaDeMe). Por defecto, un ADMIN de
 *  una automotora COMPLETA: lo que veían las pantallas antes de los rubros. */
export function sesionDePrueba(
  rubro: Partial<MeResponse> = automotoraDeMe("COMPLETA"),
  role: RoleName = "ADMIN",
): AuthContextValue {
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
