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
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { ApiKeyListPage } from "../features/apiKey/ApiKeyListPage";
import { ImportPage } from "../features/import/ImportPage";
import { IngestionEventListPage } from "../features/ingestionEvent/IngestionEventListPage";
import { SourceFormPage } from "../features/source/SourceFormPage";
import { SourceListPage } from "../features/source/SourceListPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ClaimPage } from "../features/qr/ClaimPage";
import { QrListPage } from "../features/qr/QrListPage";
import { NotFoundPlaceholder } from "./NotFoundPlaceholder";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  // R1.3 — fuera de ProtectedRoute, mismo criterio que /invite/accept de
  // abajo: ForgotPasswordPage no requiere sesión (es previo a tenerla), y
  // ResetPasswordPage recibe una sesión de recuperación real vía el link de
  // Supabase (detectSessionInUrl) antes de que este componente se monte —
  // ProtectedRoute la redirigiría a /login sin dar forma de completar el
  // cambio de contraseña, mismo problema que ya documentó AcceptInvitationPage.
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
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
          // M8: "/" deja de ser un placeholder — es el Dashboard real,
          // primera pantalla útil tras login/aceptación de invitación (ambos
          // ya redirigen acá, ver LoginPage/AcceptInvitationPage).
          { path: "/", element: <DashboardPage /> },
          { path: "/companies", element: <CompanyListPage /> },
          { path: "/contacts", element: <ContactListPage /> },
          { path: "/pipelines", element: <PipelineListPage /> },
          { path: "/pipelines/:pipelineId/stages", element: <StageListPage /> },
          { path: "/opportunities", element: <OpportunityListPage /> },
          // Lectura abierta a cualquier rol (activity.routes.ts: GET sin
          // authorize) — a diferencia de las rutas de escritura de abajo,
          // /activities NO va dentro del AdminRoute.
          { path: "/activities", element: <ActivityListPage /> },
          // Módulo QR (docs/qr-integration.md, Fase 3). El LISTADO va acá afuera,
          // como /companies y /activities: GET /api/qr es lectura abierta a
          // cualquier usuario autenticado (qr.routes.ts: solo authenticate) y las
          // acciones de solo lectura (ver imagen, enviar, copiar link) son útiles
          // para un USER. Las escrituras (crear/editar/eliminar) son diálogos
          // dentro de la página, gateados por rol ahí y por authorize("ADMIN") en
          // el backend — no hay rutas /qr/new ni /qr/:id/edit porque no existe
          // GET /api/qr/:id para hidratarlas (ver features/qr/QrFormDialog.tsx).
          { path: "/qr", element: <QrListPage /> },
          // Ruta FIJA (decisión 3 de Fase 3): la arma buildLandingHtml del backend
          // con `${QR_CLAIM_APP_URL}/claim/${qrId}`; cualquier otro path rompe los
          // QR físicos ya impresos. Dentro de ProtectedRoute (el qrId sobrevive el
          // redirect a login vía state.from, ver LoginPage) pero FUERA de
          // AdminRoute, que redirigiría a /companies y perdería el qrId — el
          // chequeo de rol lo hace la propia página (decisiones 7 y 8).
          { path: "/claim/:qrId", element: <ClaimPage /> },
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
              // Fuentes de ingesta. El LISTADO va acá adentro, no afuera como
              // /companies o /contacts: las cinco rutas de /api/sources son
              // ADMIN-only, lectura incluida (source.routes.ts), igual que
              // /users e /invitations. Paths de creación/edición con la misma
              // forma que el resto: ruta propia para "nuevo", :id/edit para
              // editar, un solo componente para las dos.
              { path: "/sources", element: <SourceListPage /> },
              { path: "/sources/new", element: <SourceFormPage /> },
              { path: "/sources/:id/edit", element: <SourceFormPage /> },
              // Subida de un archivo contra una Source FILE_IMPORT. ADMIN-only
              // como el resto de la capa de ingesta, y por el mismo motivo que
              // /imports en el backend: del otro lado hay una persona
              // autenticada, con rol y membresía que chequear, no una API key.
              { path: "/sources/:id/import", element: <ImportPage /> },
              // Claves de ingesta. Ruta plana, sin anidar bajo /sources/:id: el
              // filtro ?sourceId= cubre el mismo caso y es el que usa el link
              // "Ver claves" de SourceListPage. ADMIN-only como el resto de la
              // capa de ingesta, lectura incluida.
              { path: "/api-keys", element: <ApiKeyListPage /> },
              // Cola de eventos de ingesta: browsear, ver por qué falló una
              // fila y reprocesarla. ADMIN-only como el resto de la capa, y
              // por el mismo motivo — las dos rutas del backend llevan
              // authorize("ADMIN"), lectura incluida.
              { path: "/ingestion-events", element: <IngestionEventListPage /> },
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
