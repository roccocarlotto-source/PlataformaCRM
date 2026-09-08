import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Restricción de UX sobre las rutas de platform admin (Fase 4a del módulo
// SaaS) — mismo patrón que AdminRoute, con otra pregunta: no el rol dentro
// de la organización sino la allowlist global que GET /api/me expone como
// isPlatformAdmin. Vive DENTRO de ProtectedRoute, nunca antes: asume que la
// sesión ya está resuelta (`me` poblado).
//
// La autorización real sigue siendo exclusivamente requirePlatformAdmin en el
// backend, en cada request; esto solo evita que alguien que no es platform
// admin llegue a un formulario que el backend va a rechazar con 403.
export function PlatformAdminRoute() {
  const { me } = useAuth();

  if (me?.isPlatformAdmin !== true) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
