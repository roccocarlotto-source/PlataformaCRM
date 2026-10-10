import type { MeResponse, RoleName } from "../../auth/AuthContext";

// Rótulo de un rol para la UI. El valor ("ADMIN" / "USER" / "RECEPCION") es el
// del contrato con el backend y no cambia; lo que se muestra es la palabra que
// ya usa el pie de la sidebar (AppLayout). Role.name es `string` en el
// contrato, así que un nombre desconocido se muestra tal cual en vez de quedar
// en blanco.
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  USER: "Usuario",
  RECEPCION: "Recepción",
};

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}

// Los de una automotora: lo que se asignaba antes de R12, y lo que se usa si
// el backend no manda rolesAsignables.
const ROLES_DE_UNA_AUTOMOTORA: readonly RoleName[] = ["ADMIN", "USER"];

// Los roles que el ADMIN puede asignar en su organización: los de su rubro
// (docs/rubros.md §11.1), que manda /api/me. Una clínica: ADMIN y Recepción;
// una automotora: ADMIN y Usuario. La pantalla no tiene una tabla propia.
export function rolesAsignables(
  me: Pick<MeResponse, "rolesAsignables"> | null,
): readonly RoleName[] {
  return me?.rolesAsignables ?? ROLES_DE_UNA_AUTOMOTORA;
}

// El rol que no es ADMIN (Usuario o Recepción): el preseleccionado al invitar.
export function rolOperativo(roles: readonly RoleName[]): RoleName {
  return roles.find((rol) => rol !== "ADMIN") ?? "ADMIN";
}

export function esRolAsignable(roles: readonly RoleName[], name: string): name is RoleName {
  return (roles as readonly string[]).includes(name);
}
