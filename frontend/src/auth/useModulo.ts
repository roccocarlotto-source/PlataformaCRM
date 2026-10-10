import { useAuth, type MeResponse } from "./AuthContext";

// ---------------------------------------------------------------------------
// Ediciones (docs/ediciones.md §7): qué módulos tiene la organización, según
// `modulos` de /api/me (lo calcula el backend desde src/config/ediciones.ts;
// el frontend no tiene una tabla propia). Solo decide qué se muestra: lo que
// decide de verdad es el gate de cada request (403 MODULO_NO_INCLUIDO).
//
// Por ahora filtra SOLO en ESENCIAL. En COMPLETA devuelve siempre true, aunque
// el rubro no tenga el módulo (una clínica no tiene empresas): COMPLETA ve
// exactamente lo de siempre, y el menú por rubro es R17 (docs/rubros.md).
// Sin `me` o sin `modulos` (un backend anterior), también true.
// ---------------------------------------------------------------------------

/** La regla, sin React: la usan el hook y lo que filtra fuera de un
 *  componente (la guía de uso). */
export function tieneModulo(me: MeResponse | null | undefined, modulo: string): boolean {
  if (me?.edition !== "ESENCIAL" || me.modulos === undefined) return true;
  return me.modulos.includes(modulo);
}

export function useModulo(modulo: string): boolean {
  const { me } = useAuth();
  return tieneModulo(me, modulo);
}
