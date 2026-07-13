import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";

// HomePlaceholder sigue siendo el placeholder de M0 (todavía no hay
// dashboard real, ver M2+) — ahora vive detrás de ProtectedRoute.
// NotFoundPlaceholder queda público a propósito: un 404 no expone datos de
// negocio, no hace falta resolver sesión antes de mostrarlo.
function HomePlaceholder() {
  return <div>Plataforma CRM</div>;
}

function NotFoundPlaceholder() {
  return <div>Página no encontrada</div>;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [{ path: "/", element: <HomePlaceholder /> }],
  },
  { path: "*", element: <NotFoundPlaceholder /> },
]);
