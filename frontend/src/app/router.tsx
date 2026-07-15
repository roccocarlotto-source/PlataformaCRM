import { createBrowserRouter } from "react-router-dom";
import { AdminRoute } from "../auth/AdminRoute";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AppLayout } from "../layout/AppLayout";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
import { CompanyListPage } from "../features/company/CompanyListPage";
import { ContactFormPage } from "../features/contact/ContactFormPage";
import { ContactListPage } from "../features/contact/ContactListPage";
import { PipelineFormPage } from "../features/pipeline/PipelineFormPage";
import { PipelineListPage } from "../features/pipeline/PipelineListPage";
import { StageFormPage } from "../features/stage/StageFormPage";
import { StageListPage } from "../features/stage/StageListPage";
import { OpportunityFormPage } from "../features/opportunity/OpportunityFormPage";
import { OpportunityListPage } from "../features/opportunity/OpportunityListPage";
import { ActivityFormPage } from "../features/activity/ActivityFormPage";
import { ActivityListPage } from "../features/activity/ActivityListPage";
import { UserListPage } from "../features/user/UserListPage";
import { InvitationFormPage } from "../features/invitation/InvitationFormPage";
import { InvitationListPage } from "../features/invitation/InvitationListPage";
import { AcceptInvitationPage } from "../features/auth/AcceptInvitationPage";

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
  // Fuera de ProtectedRoute a propósito: quien acepta todavía no tiene
  // public.users (status "account-unavailable"), y ProtectedRoute
  // redirigiría a /login o mostraría el mensaje bloqueante de
  // "account-unavailable" sin dar forma de completar la aceptación — ver
  // informe de diseño de M7, hallazgo central de AcceptInvitationPage. No
  // usa :token porque no existe token propio de Invitation (ver
  // docs/authentication-architecture.md sección 2) — el "token" real ya lo
  // consumió supabase-js (detectSessionInUrl) antes de que esta ruta se
  // renderice.
  { path: "/invite/accept", element: <AcceptInvitationPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <HomePlaceholder /> },
          { path: "/companies", element: <CompanyListPage /> },
          { path: "/contacts", element: <ContactListPage /> },
          { path: "/pipelines", element: <PipelineListPage /> },
          { path: "/pipelines/:pipelineId/stages", element: <StageListPage /> },
          { path: "/opportunities", element: <OpportunityListPage /> },
          // Lectura abierta a cualquier rol (activity.routes.ts: GET sin
          // authorize) — a diferencia de las rutas de escritura de abajo,
          // /activities NO va dentro del AdminRoute.
          { path: "/activities", element: <ActivityListPage /> },
          {
            // Restricción de UX/autorización visual — ver auth/AdminRoute.tsx.
            // La autorización real de escritura sigue siendo authorize("ADMIN")
            // en el backend. Un único AdminRoute cubre las rutas de escritura
            // de Company, Contact, Pipeline, Stage, Opportunity y Activity — el
            // componente no sabe ni le importa qué ruta envuelve. M7 (Users,
            // Invitations) también entra acá, con una diferencia real: a
            // diferencia de todos los módulos anteriores, GET /api/users y
            // GET /api/invitations son TAMBIÉN ADMIN-only (verificado en
            // user.routes.ts/invitation.routes.ts) — así que /users e
            // /invitations van dentro de este bloque, no como rutas de
            // lectura abiertas (a diferencia de /activities arriba).
            element: <AdminRoute />,
            children: [
              { path: "/users", element: <UserListPage /> },
              { path: "/invitations", element: <InvitationListPage /> },
              { path: "/invitations/new", element: <InvitationFormPage /> },
              { path: "/companies/new", element: <CompanyFormPage /> },
              { path: "/companies/:id/edit", element: <CompanyFormPage /> },
              { path: "/contacts/new", element: <ContactFormPage /> },
              { path: "/contacts/:id/edit", element: <ContactFormPage /> },
              { path: "/pipelines/new", element: <PipelineFormPage /> },
              { path: "/pipelines/:id/edit", element: <PipelineFormPage /> },
              { path: "/pipelines/:pipelineId/stages/new", element: <StageFormPage /> },
              {
                path: "/pipelines/:pipelineId/stages/:stageId/edit",
                element: <StageFormPage />,
              },
              { path: "/opportunities/new", element: <OpportunityFormPage /> },
              { path: "/opportunities/:id/edit", element: <OpportunityFormPage /> },
              { path: "/activities/new", element: <ActivityFormPage /> },
              { path: "/activities/:id/edit", element: <ActivityFormPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPlaceholder /> },
]);
