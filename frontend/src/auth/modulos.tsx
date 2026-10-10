import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

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

export function useModulo(modulo: string): boolean {
  const { me } = useAuth();
  if (me?.edition !== "ESENCIAL" || me.modulos === undefined) return true;
  return me.modulos.includes(modulo);
}

// Envuelve las rutas de un módulo: si la organización no lo tiene, vuelve al
// inicio. Como AdminRoute, vive DENTRO de ProtectedRoute (sesión resuelta).
export function ModuloRoute({ modulo }: { modulo: string }) {
  const tiene = useModulo(modulo);
  if (!tiene) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
