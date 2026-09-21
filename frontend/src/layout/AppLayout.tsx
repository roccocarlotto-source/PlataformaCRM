import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Bot,
  Building,
  Building2,
  CalendarDays,
  Car,
  CheckSquare,
  Clock,
  Coins,
  Columns3,
  Database,
  History,
  Key,
  LayoutDashboard,
  MailPlus,
  MapPin,
  MessagesSquare,
  QrCode,
  Shapes,
  Target,
  UserCog,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../design-system/Button";
import { ErrorState } from "../design-system/ErrorState";
import { ThemeToggle } from "../design-system/ThemeToggle";

// Ícono + href + label de cada link, para no repetir el patrón de NavLink
// (className por isActive) en cada ítem. Los labels son EXACTAMENTE los que
// ya cubre AppLayout.test.tsx — el restyle no toca ningún texto.
function SidebarLink({
  to,
  end,
  icon: Icon,
  children,
}: {
  to: string;
  end?: boolean;
  icon: typeof LayoutDashboard;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `ds-sidebar-link${isActive ? " is-active" : ""}`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </NavLink>
  );
}

// Vive dentro de ProtectedRoute (solo se monta con status === "authenticated").
// No duplica ningún estado de sesión: `me` se lee de AuthContext tal cual,
// nunca se copia a estado local. El único estado local acá es el de la
// propia acción de logout (en curso / con error) — mismo contrato que ya
// ejercita auth/AuthContext.test.tsx (escenario 8, signOut fallido).
//
// Sidebar en vez del header horizontal anterior: estructura y valores
// tomados de Dashboard CRM.html (ver design-system.css, sección AppLayout).
// Grupos propios (CRM/Actividad/QR/Administración) en vez de los del
// mockup (CRM/Automatización) porque el mockup es de otro rubro y tiene
// secciones — Calendario, Notificaciones, Integraciones — que este producto
// todavía no tiene; Rocco eligió mostrar solo lo que existe hoy. Cuatro de
// esas secciones ya dejaron esa lista de pendientes: "Agentes IA" con el
// ítem 55, "Base de conocimiento" con el 59 y "Automatizaciones" con el 62,
// las tres en el grupo Administración, y "Conversaciones" con el 66, que va
// en el grupo CRM porque es lectura de datos y no configuración.
export function AppLayout() {
  const { me, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  // Primera vez que el nav gatea un link por rol (M7): /users e
  // /invitations son las primeras páginas TOTALMENTE inaccesibles para
  // USER (a diferencia de /companies, de lectura abierta) — mostrar el
  // link solo para que rebote siempre a un USER sería mala UX. No es un
  // RBAC genérico, es un booleano ya expuesto por AuthContext.
  const isAdmin = me?.role === "ADMIN";
  // Fase 4a del módulo SaaS: el link a la herramienta de platform admin se
  // gatea por la allowlist global (isPlatformAdmin de /me), no por el rol —
  // mismo criterio de renderizado condicional que el grupo Administración.
  const isPlatformAdmin = me?.isPlatformAdmin === true;

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      // Sin navegación manual acá: si signOut() tuvo éxito, el SIGNED_OUT
      // real hace que AuthContext pase a "unauthenticated" y ProtectedRoute
      // redirige a /login reactivamente. isLoggingOut queda en true a
      // propósito — este componente está a punto de desmontarse.
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "No se pudo cerrar sesión");
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="ds-shell">
      <aside className="ds-sidebar">
        <Link to="/" className="ds-sidebar-brand">
          <span className="ds-sidebar-brand-mark" aria-hidden="true">
            <LayoutDashboard size={16} strokeWidth={1.5} />
          </span>
          <span className="ds-sidebar-brand-name">Plataforma CRM</span>
        </Link>
        <nav className="ds-sidebar-nav">
          <SidebarLink to="/" end icon={LayoutDashboard}>
            Dashboard
          </SidebarLink>
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">CRM</span>
            <SidebarLink to="/companies" icon={Building2}>
              Empresas
            </SidebarLink>
            <SidebarLink to="/contacts" icon={Users}>
              Contactos
            </SidebarLink>
            {/* Bandeja de conversaciones (ítem 66): al lado de Contactos
                porque es lo que se habló CON ellos. En el grupo CRM y no en
                Administración —a diferencia de Agentes de IA / Base de
                conocimiento / Automatizaciones— y visible para ambos roles:
                es lectura abierta de un dato del CRM, no configuración. */}
            <SidebarLink to="/conversations" icon={MessagesSquare}>
              Conversaciones
            </SidebarLink>
            <SidebarLink to="/pipelines" icon={Columns3}>
              Procesos de venta
            </SidebarLink>
            <SidebarLink to="/opportunities" icon={Target}>
              Oportunidades
            </SidebarLink>
            {/* Stock de vehículos (Fase 3a): visible para ambos roles, como
                /companies — GET /api/vehicles es lectura abierta. */}
            <SidebarLink to="/vehicles" icon={Car}>
              Stock
            </SidebarLink>
          </div>
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">Actividad</span>
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
          </div>
          {/* Agenda (ítem 75): el módulo de reservas, que estaba completo en el
              backend sin ninguna pantalla. Reservas para ambos roles —GET y
              cancelar son `authenticate` a secas—; Recursos y Tipos de
              servicio solo ADMIN, como Sucursales: son configuración, y sus
              rutas viven dentro del AdminRoute. */}
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">Agenda</span>
            <SidebarLink to="/bookings" icon={CalendarDays}>
              Reservas
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
          </div>
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">QR</span>
            {/* Módulo QR (docs/qr-integration.md, Fase 3): visible para ambos roles,
                como /companies — GET /api/qr es de lectura abierta y las acciones
                de solo lectura (ver imagen, enviar, copiar link) sirven a un USER. */}
            <SidebarLink to="/qr" icon={QrCode}>
              QR
            </SidebarLink>
          </div>
          {isAdmin ? (
            <div className="ds-sidebar-group">
              <span className="ds-sidebar-group-label">Administración</span>
              <SidebarLink to="/users" icon={UserCog}>
                Usuarios
              </SidebarLink>
              <SidebarLink to="/invitations" icon={MailPlus}>
                Invitaciones
              </SidebarLink>
              <SidebarLink to="/sources" icon={Database}>
                Fuentes
              </SidebarLink>
              <SidebarLink to="/api-keys" icon={Key}>
                Claves
              </SidebarLink>
              <SidebarLink to="/ingestion-events" icon={History}>
                Eventos
              </SidebarLink>
              <SidebarLink to="/organization" icon={Coins}>
                Organización
              </SidebarLink>
              {/* Sucursales (ítem 20): la lectura de /api/branches es abierta, pero
                  la pantalla es toda escritura ADMIN-only — un USER ya ve las
                  sucursales donde las necesita, en BranchSelect (QR, Vehículo). */}
              <SidebarLink to="/branches" icon={MapPin}>
                Sucursales
              </SidebarLink>
              {/* Agentes de IA (ítem 55): mismo caso que Sucursales —
                  GET /api/agents es lectura abierta, pero la pantalla es toda
                  configuración ADMIN-only— y uno más: hoy no hay ninguna otra
                  pantalla donde un USER necesite ver agentes. */}
              <SidebarLink to="/agents" icon={Bot}>
                Agentes de IA
              </SidebarLink>
              {/* Base de conocimiento (ítem 59): al lado de Agentes de IA
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
            </div>
          ) : null}
          {isPlatformAdmin ? (
            <div className="ds-sidebar-group">
              <span className="ds-sidebar-group-label">Plataforma</span>
              <SidebarLink to="/admin/organizations/new" icon={Building}>
                Nueva organización
              </SidebarLink>
            </div>
          ) : null}
        </nav>
        <div className="ds-sidebar-account">
          {/* Selector de tema (§31): en el pie de la sidebar, arriba de la
              identidad y de "Cerrar sesión" — siempre a mano, sin una pantalla
              de configuración que hoy no existe. */}
          <ThemeToggle />
          <div className="ds-sidebar-account-top">
            {me ? (
              <span className="ds-sidebar-account-mark" aria-hidden="true">
                <UserRound size={16} strokeWidth={1.5} />
              </span>
            ) : null}
            <div className="ds-sidebar-account-identity">
              {me ? (
                <>
                  <span className="ds-sidebar-account-name">{me.fullName}</span>
                  <span className="ds-sidebar-account-role">
                    {isAdmin ? "Administrador" : "Usuario"}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <Button type="button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
        </div>
        {logoutError ? <ErrorState>{logoutError}</ErrorState> : null}
      </aside>
      <div className="ds-shell-body">
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
