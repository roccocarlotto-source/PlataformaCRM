import { useEffect, useId, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Bot,
  Building,
  Building2,
  CircleQuestionMark,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MessagesSquare,
  UserRound,
  Upload,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { esClinica, marcaDe } from "../auth/vocabulario";
import { useEsencialOfrecida } from "../features/platformAdmin/queries";
import { Button } from "../design-system/Button";
import { ErrorState } from "../design-system/ErrorState";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { AvisoSinSedes } from "../features/clinica/AvisoSinSedes";
import { roleLabel } from "../features/user/roles";
import { MenuDeAutomotora } from "./MenuDeAutomotora";
import { MenuDeClinica } from "./MenuDeClinica";
import { SidebarLink } from "./Sidebar";

// Vive dentro de ProtectedRoute (solo se monta con status === "authenticated").
// No duplica ningún estado de sesión: `me` se lee de AuthContext tal cual,
// nunca se copia a estado local. El único estado local acá es el de la
// propia acción de logout (en curso / con error) — mismo contrato que ya
// ejercita auth/AuthContext.test.tsx (escenario 8, signOut fallido).
//
// Sidebar en vez del header horizontal anterior: estructura y valores
// tomados de Dashboard CRM.html (ver design-system.css, sección AppLayout).
// Grupos propios en vez de los del mockup (CRM/Automatización) porque el
// mockup es de otro rubro; Rocco eligió mostrar solo lo que existe hoy.
// Desde R17 (docs/rubros.md §1.3) el menú es por rubro: MenuDeAutomotora
// (el de siempre) o MenuDeClinica; Plataforma y Ayuda son de los dos.
// Desde el ítem 79 los grupos son secciones colapsables (SidebarSection):
// CRM (con Contactos como sub-desplegable), Actividades (que fusiona las
// viejas Actividad y Agenda), Administración (que absorbió QR) y Agentes de
// IA (que dejó de vivir dentro de Administración); Plataforma sigue plana.
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
  // Rubros (docs/rubros.md §0.3): el nombre del producto sale de la
  // configuración de marca (`vocabulario.marca` de /me), no del JSX.
  const marca = marcaDe(me);
  // Fase 4a del módulo SaaS: el link a la herramienta de platform admin se
  // gatea por la allowlist global (isPlatformAdmin de /me), no por el rol —
  // mismo criterio de renderizado condicional que el grupo Administración.
  const isPlatformAdmin = me?.isPlatformAdmin === true;
  // Ediciones (docs/ediciones.md §7): "Organizaciones" (con "Pasar a edición
  // completa") aparece recién cuando el backend ofrece ESENCIAL. Solo se
  // pregunta si es platform admin.
  const esencialOfrecida = useEsencialOfrecida({ enabled: isPlatformAdmin }).ofrecida;
  // Ítem 180: el chat con el agente interno. Un ADMIN siempre (el backend ya
  // manda canUseInternalAgent true para él, pero no depende de eso); un USER
  // solo si un ADMIN lo habilitó.
  const canUseInternalAgent = isAdmin || me?.canUseInternalAgent === true;

  // Menú del celular. Por debajo de 768px (ver el bloque responsive de
  // AppLayout en design-system.css) la sidebar sale de la pantalla y se abre
  // como panel desde la barra superior; en escritorio este estado no tiene
  // ningún efecto visual. Se cierra al navegar (mismo patrón que
  // useSectionOpen: ajuste de estado durante el render ante un cambio de
  // pathname), con Escape y tocando el fondo.
  const { pathname } = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [navPathname, setNavPathname] = useState(pathname);
  if (pathname !== navPathname) {
    setNavPathname(pathname);
    setIsNavOpen(false);
  }
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Al abrir, el foco entra al panel (primer link); con Escape vuelve al
  // botón que lo abrió.
  useEffect(() => {
    if (!isNavOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsNavOpen(false);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isNavOpen]);

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
      setLogoutError(err instanceof Error ? err.message : "No pudimos cerrar sesión");
      setIsLoggingOut(false);
    }
  }

  return (
    <div className={`ds-shell${isNavOpen ? " is-nav-open" : ""}`}>
      <aside id={sidebarId} ref={sidebarRef} className="ds-sidebar">
        <Link to="/" className="ds-sidebar-brand">
          <span className="ds-sidebar-brand-mark" aria-hidden="true">
            <LayoutDashboard size={16} strokeWidth={1.5} />
          </span>
          <span className="ds-sidebar-brand-name">{marca}</span>
        </Link>
        <nav className="ds-sidebar-nav">
          {esClinica(me) ? (
            <MenuDeClinica me={me} isAdmin={isAdmin} canUseInternalAgent={canUseInternalAgent} />
          ) : (
            <MenuDeAutomotora me={me} isAdmin={isAdmin} canUseInternalAgent={canUseInternalAgent} />
          )}
          {isPlatformAdmin ? (
            <div className="ds-sidebar-group">
              <span className="ds-sidebar-group-label">Plataforma</span>
              <SidebarLink to="/admin/organizations/new" icon={Building}>
                Nueva organización
              </SidebarLink>
              {/* end: si no, también queda marcado en /admin/organizations/new. */}
              {esencialOfrecida ? (
                <SidebarLink to="/admin/organizations" end icon={Building2}>
                  Organizaciones
                </SidebarLink>
              ) : null}
              <SidebarLink to="/admin/agents/whatsapp-number" icon={MessageCircle}>
                Número de WhatsApp
              </SidebarLink>
              <SidebarLink to="/admin/agents/facebook-page" icon={MessagesSquare}>
                Página de Facebook
              </SidebarLink>
              <SidebarLink to="/admin/agents/model" icon={Bot}>
                Modelo de IA
              </SidebarLink>
              {/* B4: el gasto en el modelo por organización, últimos 30 días. */}
              <SidebarLink to="/admin/llm-usage" icon={Activity}>
                Uso de IA
              </SidebarLink>
              <SidebarLink to="/admin/imports" icon={Upload}>
                Importar datos
              </SidebarLink>
            </div>
          ) : null}
          {/* Ayuda: la guía de uso (features/guia). Último ítem del nav, para
              los dos roles, fuera de toda sección: no pertenece a ningún
              módulo, es sobre todos. */}
          <div className="ds-sidebar-group ds-sidebar-group--ayuda">
            <SidebarLink to="/ayuda" icon={CircleQuestionMark}>
              Ayuda
            </SidebarLink>
          </div>
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
                  <span className="ds-sidebar-account-role">{roleLabel(me.role)}</span>
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
      {isNavOpen ? (
        <div
          className="ds-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setIsNavOpen(false)}
        />
      ) : null}
      <div className="ds-shell-body">
        {/* Barra superior: solo se ve en el celular (CSS), donde la sidebar
            no entra al lado del contenido. */}
        <header className="ds-topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="ds-topbar-menu"
            aria-label={isNavOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={isNavOpen}
            aria-controls={sidebarId}
            onClick={() => setIsNavOpen((open) => !open)}
          >
            <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <Link to="/" className="ds-topbar-brand">
            <span className="ds-sidebar-brand-mark" aria-hidden="true">
              <LayoutDashboard size={16} strokeWidth={1.5} />
            </span>
            <span className="ds-sidebar-brand-name">{marca}</span>
          </Link>
        </header>
        <main>
          {/* R20: el aviso de una Recepción de clínica sin sedes; para el
              resto no renderiza nada. */}
          <AvisoSinSedes />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
