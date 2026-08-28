import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../design-system/Button";
import { ErrorState } from "../design-system/ErrorState";

// Vive dentro de ProtectedRoute (solo se monta con status === "authenticated").
// No duplica ningún estado de sesión: `me` se lee de AuthContext tal cual,
// nunca se copia a estado local. El único estado local acá es el de la
// propia acción de logout (en curso / con error) — mismo contrato que ya
// ejercita auth/AuthContext.test.tsx (escenario 8, signOut fallido).
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
    <div>
      <header className="ds-app-header">
        <nav className="ds-app-nav">
          <Link to="/" className="ds-app-brand">
            Plataforma CRM
          </Link>
          <Link to="/companies">Empresas</Link>
          <Link to="/contacts">Contactos</Link>
          <Link to="/pipelines">Pipelines</Link>
          <Link to="/opportunities">Oportunidades</Link>
          <Link to="/activities">Actividades</Link>
          {isAdmin ? (
            <>
              <Link to="/users">Usuarios</Link>
              <Link to="/invitations">Invitaciones</Link>
              <Link to="/sources">Fuentes</Link>
              <Link to="/api-keys">Claves</Link>
              <Link to="/ingestion-events">Eventos</Link>
            </>
          ) : null}
        </nav>
        <div className="ds-app-account">
          {me ? <span>{me.fullName}</span> : null}
          <Button type="button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
          {logoutError ? <ErrorState>{logoutError}</ErrorState> : null}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
