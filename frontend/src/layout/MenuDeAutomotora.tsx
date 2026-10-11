import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  CalendarRange,
  Car,
  CheckSquare,
  Clock,
  Coins,
  Columns3,
  Database,
  History,
  Key,
  LayoutDashboard,
  ListChecks,
  MailPlus,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  QrCode,
  Settings2,
  Shapes,
  Target,
  TicketCheck,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import type { MeResponse } from "../auth/AuthContext";
import { tieneModulo } from "../auth/useModulo";
import { SidebarLink, SidebarSection } from "./Sidebar";

// El menú de una automotora (docs/rubros.md §1.3): el de siempre, sin ningún
// cambio. Lo fija menuAutomotora.test.tsx (suite "automotora sin cambios",
// §14.1). Lo de clínica vive en MenuDeClinica.
export function MenuDeAutomotora({
  me,
  isAdmin,
  canUseInternalAgent,
}: {
  me: MeResponse | null;
  isAdmin: boolean;
  canUseInternalAgent: boolean;
}) {
  // Ediciones (docs/ediciones.md §7): sin el módulo, el link no aparece.
  const tieneEmpresas = tieneModulo(me, "empresas");
  const tieneProcesosDeVenta = tieneModulo(me, "procesos_de_venta");

  return (
    <>
      <SidebarLink to="/" end icon={LayoutDashboard}>
        Dashboard
      </SidebarLink>
      {/* Agente interno (ítem 180): suelto, al lado de Dashboard, y no dentro
          de "Agentes de IA" — esa sección es ADMIN-only entera, y esto lo usa
          también un USER habilitado. Es una herramienta de trabajo diaria,
          no configuración. */}
      {canUseInternalAgent ? (
        <SidebarLink to="/internal-agent" end icon={MessageSquareText}>
          Agente interno
        </SidebarLink>
      ) : null}
      {/* Canjear cupón (ítem 178): para cualquier rol, igual que el canje en
          el backend (sin authorize). Suelto al lado del agente interno por
          el mismo motivo: herramienta de mostrador. */}
      <SidebarLink to="/vouchers/scan" end icon={TicketCheck}>
        Canjear cupón
      </SidebarLink>
      <SidebarSection
        label="CRM"
        paths={[
          "/contacts",
          "/conversations",
          "/companies",
          "/opportunities",
          "/pipelines",
          "/vehicles",
        ]}
      >
        {/* Contactos (ítem 79) es a la vez link a /contacts y sub-desplegable
            de lo que cuelga de un contacto: lo que se habló con él, su
            empresa y sus oportunidades. */}
        <SidebarSection
          label="Contactos"
          link={{ to: "/contacts", icon: Users }}
          nested
          paths={["/conversations", "/companies", "/opportunities"]}
        >
          {/* Bandeja de conversaciones (ítem 66): debajo de Contactos
              porque es lo que se habló CON ellos. En el grupo CRM y no en
              Administración —a diferencia de Agentes de IA / Base de
              conocimiento / Automatizaciones— y visible para ambos roles:
              es lectura abierta de un dato del CRM, no configuración. */}
          <SidebarLink to="/conversations" icon={MessagesSquare}>
            Conversaciones
          </SidebarLink>
          {tieneEmpresas ? (
            <SidebarLink to="/companies" icon={Building2}>
              Empresas
            </SidebarLink>
          ) : null}
          <SidebarLink to="/opportunities" icon={Target}>
            Oportunidades
          </SidebarLink>
        </SidebarSection>
        {tieneProcesosDeVenta ? (
          <SidebarLink to="/pipelines" icon={Columns3}>
            Procesos de venta
          </SidebarLink>
        ) : null}
        {/* Stock de vehículos (Fase 3a): visible para ambos roles, como
            /companies — GET /api/vehicles es lectura abierta. */}
        <SidebarLink to="/vehicles" icon={Car}>
          Stock
        </SidebarLink>
      </SidebarSection>
      {/* Actividades (ítem 79): fusiona los grupos "Actividad" y "Agenda"
          que había antes; cada link conserva su propio permiso. */}
      <SidebarSection
        label="Actividades"
        paths={["/activities", "/tasks", "/bookings", "/agenda", "/resources", "/service-types"]}
      >
        {/* Listado completo "Actividades" (ítem 25): solo ADMIN, como
            Organización/Sucursales — /activities está dentro del AdminRoute
            y el backend acota a un USER a lo asignado a sí mismo, que ya
            ve en "Mis tareas". */}
        {isAdmin ? (
          <SidebarLink to="/activities" icon={Activity}>
            Actividades
          </SidebarLink>
        ) : null}
        {/* "Mis tareas": nav plano, para ambos roles — un USER puede leer
            lo asignado a sí mismo (activity.service.ts) y completar la
            propia tarea (PATCH solo completedAt sobre la propia) desde la
            fase de "Mis tareas" (activity.routes.ts). */}
        <SidebarLink to="/tasks" icon={CheckSquare}>
          Mis tareas
        </SidebarLink>
        {/* Agenda (ítem 75): el módulo de reservas, que estaba completo en
            el backend sin ninguna pantalla. Reservas para ambos roles —GET
            y cancelar son `authenticate` a secas—, y Calendario (ítem 77)
            igual; Recursos y Tipos de servicio solo ADMIN, como
            Sucursales: son configuración, y sus rutas viven dentro del
            AdminRoute. */}
        <SidebarLink to="/bookings" icon={CalendarDays}>
          Reservas
        </SidebarLink>
        <SidebarLink to="/agenda" icon={CalendarRange}>
          Calendario
        </SidebarLink>
        {isAdmin ? (
          <>
            <SidebarLink to="/resources" icon={Shapes}>
              Recursos
            </SidebarLink>
            <SidebarLink to="/service-types" icon={Clock}>
              Tipos de servicio
            </SidebarLink>
          </>
        ) : null}
      </SidebarSection>
      {/* Administración (ítem 79): la sección se renderiza para AMBOS
          roles porque ahora contiene QR, que un USER ya tenía; cada link
          se gatea con su propio permiso. Envolverla entera en isAdmin
          le sacaría el QR a un USER. */}
      <SidebarSection
        label="Administración"
        paths={[
          "/qr",
          "/users",
          "/invitations",
          "/sources",
          "/api-keys",
          "/ingestion-events",
          "/organization",
          "/branches",
          "/contact-custom-fields",
        ]}
      >
        {/* Módulo QR (docs/qr-integration.md, Fase 3): visible para ambos roles,
            como /companies — GET /api/qr es de lectura abierta y las acciones
            de solo lectura (ver imagen, enviar, copiar link) sirven a un USER. */}
        <SidebarLink to="/qr" icon={QrCode}>
          QR
        </SidebarLink>
        {isAdmin ? (
          <>
            <SidebarLink to="/users" icon={UserCog}>
              Usuarios
            </SidebarLink>
            <SidebarLink to="/invitations" icon={MailPlus}>
              Invitaciones
            </SidebarLink>
            <SidebarLink to="/sources" icon={Database}>
              Fuentes de ingesta
            </SidebarLink>
            <SidebarLink to="/api-keys" icon={Key}>
              Claves de ingesta
            </SidebarLink>
            <SidebarLink to="/ingestion-events" icon={History}>
              Eventos de ingesta
            </SidebarLink>
            <SidebarLink to="/organization" icon={Coins}>
              Organización
            </SidebarLink>
            {/* Acá estaba "Plantillas de WhatsApp" (ítem 160). Se retiró:
                el mensaje se configura en la propia regla de
                automatización, y la plantilla de Meta se arma sola. */}
            {/* Sucursales (ítem 20): la lectura de /api/branches es abierta, pero
                la pantalla es toda escritura ADMIN-only — un USER ya ve las
                sucursales donde las necesita, en BranchSelect (QR, Vehículo). */}
            <SidebarLink to="/branches" icon={MapPin}>
              Sucursales
            </SidebarLink>
            {/* Campos personalizados de contactos (B6): los define el ADMIN;
                la ficha los muestra a todos. */}
            <SidebarLink to="/contact-custom-fields" icon={ListChecks}>
              Campos de contacto
            </SidebarLink>
          </>
        ) : null}
      </SidebarSection>
      {/* Agentes de IA (ítem 55): mismo caso que Sucursales —
          GET /api/agents es lectura abierta, pero la pantalla es toda
          configuración ADMIN-only— y uno más: hoy no hay ninguna otra
          pantalla donde un USER necesite ver agentes. Desde el ítem 79 es
          una sección propia, ADMIN-only entera, cuyo título es el link a
          /agents y a la vez pliega lo que cuelga del módulo. */}
      {isAdmin ? (
        <SidebarSection
          label="Agentes de IA"
          link={{ to: "/agents", icon: Bot }}
          paths={["/knowledge-base", "/automations", "/internal-agent/settings"]}
        >
          {/* Base de conocimiento (ítem 59): debajo de Agentes de IA
              porque es el dato que ellos consumen, y con el mismo criterio
              de permisos — GET abierto, pantalla ADMIN-only. */}
          <SidebarLink to="/knowledge-base" icon={BookOpen}>
            Base de conocimiento
          </SidebarLink>
          {/* Automatizaciones (ítem 62): las reglas trigger → acción del
              motor construido en docs/automations-architecture.md, con el
              mismo criterio de permisos que las dos de arriba — GET
              abierto, pantalla ADMIN-only. */}
          <SidebarLink to="/automations" icon={Zap}>
            Automatizaciones
          </SidebarLink>
          {/* Configuración del agente interno (ítem 180): mismo criterio que
              las dos de arriba — configuración de un módulo de IA,
              ADMIN-only incluida la lectura. */}
          <SidebarLink to="/internal-agent/settings" icon={Settings2}>
            Configurar agente interno
          </SidebarLink>
        </SidebarSection>
      ) : null}
    </>
  );
}
