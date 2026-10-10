import type { MeResponse } from "../../auth/AuthContext";

// ---------------------------------------------------------------------------
// Usuarios por sede (docs/rubros.md §11.5, R20). Solo clínicas.
//
// `me.sedes` lo manda el backend solo en una clínica: "todas" para un ADMIN, y
// para una Recepción la lista de sus sedes ([] = sin sedes). En una automotora
// la clave no está y nada de esto cambia lo que se ve. Lo que decide es el
// backend en cada pedido (sedesDelActor); esto es para mostrar.
// ---------------------------------------------------------------------------

export interface SedeAsignada {
  id: string;
  name: string;
}

/** Las sedes de quien entra, o null si no tiene límite (automotora, ADMIN). */
export function sedesDeQuienEntra(me: MeResponse | null | undefined): SedeAsignada[] | null {
  const sedes = me?.sedes;
  return Array.isArray(sedes) ? sedes : null;
}

/** De estas sucursales, las que puede elegir quien entra: todas, salvo para
 *  una Recepción de clínica, que elige entre las suyas. */
export function sucursalesDeQuienEntra<T extends { id: string }>(
  sucursales: T[],
  me: MeResponse | null | undefined,
): T[] {
  const sedes = sedesDeQuienEntra(me);
  if (sedes === null) return sucursales;
  const suyas = new Set(sedes.map((s) => s.id));
  return sucursales.filter((s) => suyas.has(s.id));
}

export const AVISO_SIN_SEDES =
  "No tenés sedes asignadas. Pedile a un administrador que te asigne una.";
