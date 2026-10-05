import type { MeResponse } from "./AuthContext";

// ---------------------------------------------------------------------------
// Qué puede escribir cada rol sobre contactos y oportunidades (decisión D2;
// OPUS-I-03, docs-privados, local). Es la MISMA regla que aplica el backend
// (src/services/permisosDelVendedor.ts), repetida acá solo para decidir qué
// botones se muestran: la autorización real está en cada request.
//
//   - crear: cualquiera con sesión (lo de un USER queda a su nombre);
//   - editar: un ADMIN, o quien lo tiene asignado;
//   - borrar, unir, reasignar: solo ADMIN.
// ---------------------------------------------------------------------------

type Yo = Pick<MeResponse, "id" | "role"> | null | undefined;

export function esAdmin(me: Yo): boolean {
  return me?.role === "ADMIN";
}

export function puedeEditarRegistro(me: Yo, registro: { ownerId: string | null }): boolean {
  if (!me) return false;
  return me.role === "ADMIN" || registro.ownerId === me.id;
}

export const AVISO_SOLO_LECTURA =
  "Está asignado a otra persona: solo quien lo tiene asignado o un administrador puede editarlo.";
