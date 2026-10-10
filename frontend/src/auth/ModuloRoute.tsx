import { Navigate, Outlet } from "react-router-dom";
import { useModulo } from "./useModulo";

// Envuelve las rutas de un módulo (docs/ediciones.md §7): si la organización
// no lo tiene, vuelve al inicio. Como AdminRoute, vive DENTRO de
// ProtectedRoute (sesión resuelta). La regla es la de useModulo.
export function ModuloRoute({ modulo }: { modulo: string }) {
  const tiene = useModulo(modulo);
  if (!tiene) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
