import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Building2,
  CheckSquare,
  Columns3,
  Database,
  History,
  Key,
  LayoutDashboard,
  MailPlus,
  QrCode,
  Target,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../design-system/Button";
import { ErrorState } from "../design-system/ErrorState";

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
// secciones — Conversaciones, Agentes IA, Calendario, Notificaciones,
// Base de conocimiento, Automatizaciones, Integraciones — que este
// producto no tiene; Rocco eligió mostrar solo lo que existe hoy.
export function AppLayout() {
  const { me, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  // Primera vez que el nav gatea un link por rol (M7): /users e
  // /invitations son las primeras páginas TOTALMENTE inaccesibles para
  // USER (a diferencia de /activities, de lectura abierta) — mostrar el
  // link solo para que rebote siempre a un USER sería mala UX. No es un
  // RBAC genérico, es un booleano ya expuesto por AuthContext.
  const isAdmin = me?.role === "ADMIN";

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
            <SidebarLink to="/pipelines" icon={Columns3}>
              Pipelines
            </SidebarLink>
            <SidebarLink to="/opportunities" icon={Target}>
              Oportunidades
            </SidebarLink>
          </div>
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">Actividad</span>
            <SidebarLink to="/activities" icon={Activity}>
              Actividades
            </SidebarLink>
            {/* "Mis tareas": nav plano, para ambos roles, como /activities —
                GET /api/activities es lectura abierta, y completar la propia
                tarea (PATCH solo completedAt sobre la propia) también lo es
                para cualquier rol desde esta fase (activity.routes.ts). */}
            <SidebarLink to="/tasks" icon={CheckSquare}>
              Mis tareas
            </SidebarLink>
          </div>
          <div className="ds-sidebar-group">
            <span className="ds-sidebar-group-label">QR</span>
            {/* Módulo QR (docs/qr-integration.md, Fase 3): visible para ambos roles,
                como /activities — GET /api/qr es de lectura abierta y las acciones
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
            </div>
          ) : null}
        </nav>
        <div className="ds-sidebar-account">
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
