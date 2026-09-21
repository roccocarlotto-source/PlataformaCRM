import { createBrowserRouter } from "react-router-dom";
import { AdminRoute } from "../auth/AdminRoute";
import { PlatformAdminRoute } from "../auth/PlatformAdminRoute";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AppLayout } from "../layout/AppLayout";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
import { CompanyListPage } from "../features/company/CompanyListPage";
import { ContactFormPage } from "../features/contact/ContactFormPage";
import { ContactListPage } from "../features/contact/ContactListPage";
import { ConversationDetail } from "../features/conversation/ConversationDetail";
import { ConversationListPage } from "../features/conversation/ConversationListPage";
import { PipelineFormPage } from "../features/pipeline/PipelineFormPage";
import { PipelineListPage } from "../features/pipeline/PipelineListPage";
import { StageFormPage } from "../features/stage/StageFormPage";
import { StageListPage } from "../features/stage/StageListPage";
import { OpportunityFormPage } from "../features/opportunity/OpportunityFormPage";
import { OpportunityListPage } from "../features/opportunity/OpportunityListPage";
import { ActivityFormPage } from "../features/activity/ActivityFormPage";
import { ActivityListPage } from "../features/activity/ActivityListPage";
import { MyTasksPage } from "../features/activity/MyTasksPage";
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
import { VehicleFormPage } from "../features/vehicle/VehicleFormPage";
import { VehicleListPage } from "../features/vehicle/VehicleListPage";
import { NewOrganizationPage } from "../features/platformAdmin/NewOrganizationPage";
import { OrganizationSettingsPage } from "../features/organization/OrganizationSettingsPage";
import { BranchFormPage } from "../features/branch/BranchFormPage";
import { BranchListPage } from "../features/branch/BranchListPage";
import { AgentEmbedPage } from "../features/agent/AgentEmbedPage";
import { AgentFormPage } from "../features/agent/AgentFormPage";
import { AgentListPage } from "../features/agent/AgentListPage";
import { AgentPlaygroundPage } from "../features/agent/AgentPlaygroundPage";
import { KnowledgeBaseFormPage } from "../features/knowledgeBase/KnowledgeBaseFormPage";
import { KnowledgeBaseListPage } from "../features/knowledgeBase/KnowledgeBaseListPage";
import { AutomationFormPage } from "../features/automation/AutomationFormPage";
import { AutomationListPage } from "../features/automation/AutomationListPage";
import { BookingCalendarPage } from "../features/booking/BookingCalendarPage";
import { BookingListPage } from "../features/booking/BookingListPage";
import { ResourceFormPage } from "../features/resource/ResourceFormPage";
import { ResourceListPage } from "../features/resource/ResourceListPage";
import { ServiceTypeFormPage } from "../features/serviceType/ServiceTypeFormPage";
import { ServiceTypeListPage } from "../features/serviceType/ServiceTypeListPage";
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
          // Bandeja de conversaciones (ítem 66 de
          // docs/frontend-cambios-pendientes.md): lo que hablaron los agentes
          // de IA con los contactos. ACÁ AFUERA, y no dentro del AdminRoute
          // donde viven /agents, /knowledge-base y /automations: esas tres
          // son pantallas de configuración del módulo, y esto es un dato del
          // CRM que un vendedor necesita leer, como /contacts o /vehicles.
          // Las dos rutas del backend son `authenticate` a secas —no hay
          // ninguna escritura que gatear, ver src/routes/conversation.routes.ts—
          // así que un USER las lee sin 403. Mismo criterio que el GET abierto
          // de /knowledge-base, con la conclusión contraria por lo que la
          // pantalla ES.
          { path: "/conversations", element: <ConversationListPage /> },
          { path: "/conversations/:id", element: <ConversationDetail /> },
          { path: "/pipelines", element: <PipelineListPage /> },
          { path: "/pipelines/:pipelineId/stages", element: <StageListPage /> },
          { path: "/opportunities", element: <OpportunityListPage /> },
          // "Mis tareas" (ítem 25 de docs/frontend-cambios-pendientes.md): la
          // única pantalla de actividades para USER. GET /api/activities sigue
          // sin authorize en la ruta (activity.routes.ts) pero el service acota
          // la lectura de un USER a lo asignado a sí mismo, que es exactamente
          // lo que esta pantalla pide (assigneeId=<yo>&confirmed=false, §29);
          // y la acción principal (tildar la propia tarea) es PATCH de solo
          // completedAt sobre la propia actividad, permitido a cualquier rol —
          // así que NO va en AdminRoute. El listado completo (/activities) sí,
          // abajo.
          { path: "/tasks", element: <MyTasksPage /> },
          // Módulo QR (docs/qr-integration.md, Fase 3). El LISTADO va acá afuera,
          // como /companies: GET /api/qr es lectura abierta a
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
          // Stock de vehículos (Fase 3a). El LISTADO va acá afuera, como
          // /companies: GET /api/vehicles y GET /api/vehicles/:id son lectura
          // abierta a cualquier autenticado (vehicle.routes.ts: solo
          // authenticate). Las rutas de creación/edición van dentro del
          // AdminRoute de abajo, mismo patrón que Activity/Opportunity.
          { path: "/vehicles", element: <VehicleListPage /> },
          // Reservas de la Agenda (ítem 75 de docs/frontend-cambios-pendientes.md).
          // ACÁ AFUERA, a diferencia de /resources y /service-types: las dos
          // rutas que consume la pantalla —GET /api/bookings y
          // PATCH /api/bookings/:id/cancel— son `authenticate` a secas
          // (booking.routes.ts), porque ver quién viene y cancelar un turno es
          // la operación cotidiana de quien atiende, no configuración.
          { path: "/bookings", element: <BookingListPage /> },
          // Calendario de la Agenda (ítem 77): ACÁ AFUERA por lo mismo que
          // /bookings — además lee GET /api/resources y
          // /api/resources/:id/working-hours, de lectura abierta, y crea con
          // POST /api/bookings, `authenticate` a secas. Forzar fuera de
          // horario es solo ADMIN, y eso lo decide el backend (403).
          { path: "/agenda", element: <BookingCalendarPage /> },
          {
            // Restricción de UX/autorización visual — ver auth/AdminRoute.tsx.
            // La autorización real de escritura sigue siendo authorize("ADMIN")
            // en el backend. Un único AdminRoute cubre las rutas de escritura
            // de Company, Contact, Pipeline, Stage, Opportunity y Activity — el
            // componente no sabe ni le importa qué ruta envuelve. Una sola
            // excepción, y no cambia este bloque: PATCH /api/activities/:id
            // admite que un USER complete SU propia actividad mandando solo
            // completedAt (activity.service.ts) — eso lo usa /tasks, arriba;
            // /activities/:id/edit manda todos los campos y sigue siendo
            // ADMIN-only, así que sigue acá adentro. M7 (Users,
            // Invitations) también entra acá, con una diferencia real: a
            // diferencia de todos los módulos anteriores, GET /api/users y
            // GET /api/invitations son TAMBIÉN ADMIN-only (verificado en
            // user.routes.ts/invitation.routes.ts) — así que /users e
            // /invitations van dentro de este bloque, no como rutas de
            // lectura abiertas (a diferencia de /companies arriba).
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
              // Configuración de moneda de la organización (ítem 19.A de
              // docs/frontend-cambios-pendientes.md). Singleton: sin :id, sin
              // "nuevo". GET /api/organization es lectura abierta, pero la
              // pantalla es toda escritura (PATCH ADMIN-only), así que va acá
              // adentro como /sources.
              { path: "/organization", element: <OrganizationSettingsPage /> },
              // Sucursales (ítem 20 de docs/frontend-cambios-pendientes.md). El
              // LISTADO va acá adentro aunque GET /api/branches sea de lectura
              // abierta (branch.routes.ts): la pantalla es toda escritura
              // (POST/PATCH/DELETE ADMIN-only) y un USER ya ve las sucursales
              // donde las necesita, en BranchSelect — mismo criterio que
              // /organization. Misma forma de paths que /sources.
              { path: "/branches", element: <BranchListPage /> },
              { path: "/branches/new", element: <BranchFormPage /> },
              { path: "/branches/:id/edit", element: <BranchFormPage /> },
              // Agentes de IA (ítem 55 de docs/frontend-cambios-pendientes.md;
              // diseño en docs/ai-agent-architecture.md). MISMO esquema de
              // permisos que Branch —GET abierto, POST/PATCH/DELETE ADMIN-only
              // en agent.routes.ts— y el listado va igualmente acá adentro,
              // por el mismo criterio que /branches: la pantalla es toda
              // configuración administrativa (crear, editar, borrar agentes,
              // sus tokens de embed, su probador), y la autorización real de
              // escritura sigue siendo del backend.
              //
              // Desde el ítem 66 un USER SÍ ve agentes en otra pantalla —la
              // bandeja de conversaciones muestra qué agente atendió cada
              // una y deja filtrar por agente, consumiendo el mismo GET
              // abierto—. Eso no cambia nada de esto: lo que lo mantiene acá
              // adentro es lo que la pantalla HACE, no que el dato sea
              // secreto.
              { path: "/agents", element: <AgentListPage /> },
              { path: "/agents/new", element: <AgentFormPage /> },
              { path: "/agents/:id/edit", element: <AgentFormPage /> },
              // "Instalar en un sitio" (ítem 63 de
              // docs/frontend-cambios-pendientes.md): los dominios permitidos,
              // los tokens de embed y el <script> del widget de ESE agente.
              // Acá adentro como el resto del módulo, y con un motivo propio
              // además del criterio general: las tres rutas de tokens son
              // authorize("ADMIN") en el backend —la LECTURA incluida, a
              // diferencia del GET del agente— porque son credenciales.
              { path: "/agents/:id/embed", element: <AgentEmbedPage /> },
              // "Probar agente" (ítem 65): mandarle mensajes a mano al agente
              // como si fueran del contacto. Acá adentro por el mismo motivo
              // concreto que /embed: POST /api/agents/:id/test-message es
              // authorize("ADMIN"). Y además porque no es un simulador —
              // corre el loop de orquestación real y puede crear
              // oportunidades, calificar al lead o derivar a un vendedor.
              { path: "/agents/:id/playground", element: <AgentPlaygroundPage /> },
              // Base de conocimiento (ítem 59 de
              // docs/frontend-cambios-pendientes.md): el texto del negocio que
              // se suma automáticamente al prompt de los agentes de cada
              // sucursal. MISMO criterio exacto que /agents y /branches —
              // GET /api/knowledge-base es lectura abierta, pero la pantalla
              // es toda configuración ADMIN-only y hoy no hay ninguna otra
              // pantalla que necesite mostrarle esto a un USER: quien lo lee
              // de verdad es el agente, del lado del backend.
              { path: "/knowledge-base", element: <KnowledgeBaseListPage /> },
              { path: "/knowledge-base/new", element: <KnowledgeBaseFormPage /> },
              { path: "/knowledge-base/:id/edit", element: <KnowledgeBaseFormPage /> },
              // Automatizaciones (ítem 62 de
              // docs/frontend-cambios-pendientes.md): las reglas trigger →
              // acción del motor que ya estaba construido del lado del backend
              // (docs/automations-architecture.md). MISMO criterio exacto que
              // /knowledge-base y /agents — GET /api/automations es lectura
              // abierta a cualquier autenticado, pero la pantalla es toda
              // configuración ADMIN-only (POST/PATCH/DELETE son
              // authorize("ADMIN")) y hoy no hay ninguna otra pantalla que
              // necesite mostrarle reglas a un USER: quien las lee de verdad
              // es el dispatcher, del lado del backend.
              { path: "/automations", element: <AutomationListPage /> },
              { path: "/automations/new", element: <AutomationFormPage /> },
              { path: "/automations/:id/edit", element: <AutomationFormPage /> },
              // Recursos y Tipos de servicio de la Agenda (ítem 75). MISMO
              // criterio que /branches y /knowledge-base: el GET es de lectura
              // abierta —un USER lo consume en los filtros de /bookings— pero
              // estas pantallas son toda configuración ADMIN-only
              // (POST/PATCH/DELETE y el PUT del horario llevan
              // authorize("ADMIN")). El horario laboral no tiene ruta propia:
              // vive dentro del formulario del recurso.
              { path: "/resources", element: <ResourceListPage /> },
              { path: "/resources/new", element: <ResourceFormPage /> },
              { path: "/resources/:id/edit", element: <ResourceFormPage /> },
              { path: "/service-types", element: <ServiceTypeListPage /> },
              { path: "/service-types/new", element: <ServiceTypeFormPage /> },
              { path: "/service-types/:id/edit", element: <ServiceTypeFormPage /> },
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
              // Listado completo de actividades de la organización (ítem 25 de
              // docs/frontend-cambios-pendientes.md): ADMIN-only. Hasta ese
              // ítem vivía afuera como lectura abierta; ahora el backend acota
              // a un USER a lo asignado a sí mismo, que ya tiene su pantalla en
              // /tasks (arriba) — una tabla "Actividades" para USER solo
              // repetiría "Mis tareas" con filtros que no puede usar. Mismo
              // criterio que /organization y /branches: la autorización real
              // es del service; esto evita mostrar una pantalla vacía de
              // sentido para ese rol.
              { path: "/activities", element: <ActivityListPage /> },
              { path: "/activities/new", element: <ActivityFormPage /> },
              { path: "/activities/:id/edit", element: <ActivityFormPage /> },
              // Ficha de vehículo: POST/PATCH /api/vehicles son ADMIN-only, y la
              // ficha es toda escritura (incluida la galería de fotos).
              { path: "/vehicles/new", element: <VehicleFormPage /> },
              { path: "/vehicles/:id/edit", element: <VehicleFormPage /> },
            ],
          },
          {
            // Herramienta de platform admin (Fase 4a del módulo SaaS): alta
            // de una organización nueva con su primer ADMIN. Va bajo
            // PlatformAdminRoute y NO bajo AdminRoute: la pregunta es la
            // allowlist global de platform_admins (isPlatformAdmin de /me),
            // no el rol dentro de la organización — un platform admin con rol
            // USER en la suya tiene que poder entrar, y un ADMIN común no. La
            // autorización real es requirePlatformAdmin en el backend.
            element: <PlatformAdminRoute />,
            children: [{ path: "/admin/organizations/new", element: <NewOrganizationPage /> }],
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPlaceholder /> },
]);
