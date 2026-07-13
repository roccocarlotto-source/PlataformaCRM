import { createBrowserRouter } from "react-router-dom";
import { AdminRoute } from "../auth/AdminRoute";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AppLayout } from "../layout/AppLayout";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
import { CompanyListPage } from "../features/company/CompanyListPage";

// HomePlaceholder sigue siendo el placeholder de M0 (todavía no hay
// dashboard real, ver M3+) — ahora vive detrás de ProtectedRoute + AppLayout.
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
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <HomePlaceholder /> },
          { path: "/companies", element: <CompanyListPage /> },
          {
            // Restricción de UX/autorización visual — ver auth/AdminRoute.tsx.
            // La autorización real de escritura sigue siendo authorize("ADMIN")
            // en el backend.
            element: <AdminRoute />,
            children: [
              { path: "/companies/new", element: <CompanyFormPage /> },
              { path: "/companies/:id/edit", element: <CompanyFormPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPlaceholder /> },
]);
