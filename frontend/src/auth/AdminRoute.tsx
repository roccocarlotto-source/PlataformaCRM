import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Restricción de UX/autorización visual sobre rutas de escritura de Company
// (create/edit) — vive DENTRO de ProtectedRoute, nunca antes: asume que la
// sesión ya está resuelta (status==="authenticated", `me` poblado).
// La autorización real sigue siendo exclusivamente authorize("ADMIN") en el
// backend; esto solo evita que un USER complete un formulario que el
// backend va a rechazar con 403 recién al guardar.
export function AdminRoute() {
  const { me } = useAuth();

  if (me?.role !== "ADMIN") {
    return <Navigate to="/companies" replace />;
  }

  return <Outlet />;
}
