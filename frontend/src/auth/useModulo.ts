import { useAuth, type MeResponse } from "./AuthContext";

// ---------------------------------------------------------------------------
// Ediciones y rubros (docs/ediciones.md §7, docs/rubros.md §2): qué módulos
// tiene la organización, según `modulos` de /api/me (lo calcula el backend
// desde src/config/ediciones.ts, con la edición Y el rubro; el frontend no
// tiene una tabla propia). Solo decide qué se muestra: lo que decide de verdad
// es el gate de cada request (403 MODULO_NO_INCLUIDO).
//
// Lee la lista en las dos ediciones (R17): una clínica en COMPLETA no tiene
// stock, oportunidades ni empresas, y no los ve. Para una automotora no cambia
// nada: en COMPLETA su lista trae todos los módulos que el frontend pregunta
// (lo fija useModulo.test.tsx). Sin `me` o sin `modulos` (un backend
// anterior), true, como siempre.
// ---------------------------------------------------------------------------

/** La regla, sin React: la usan el hook y lo que filtra fuera de un
 *  componente (la guía de uso, el menú). */
export function tieneModulo(me: MeResponse | null | undefined, modulo: string): boolean {
  if (me?.modulos === undefined) return true;
  return me.modulos.includes(modulo);
}

export function useModulo(modulo: string): boolean {
  const { me } = useAuth();
  return tieneModulo(me, modulo);
}
