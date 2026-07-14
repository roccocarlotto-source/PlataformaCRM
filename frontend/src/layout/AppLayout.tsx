import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

// Vive dentro de ProtectedRoute (solo se monta con status === "authenticated").
// No duplica ningún estado de sesión: `me` se lee de AuthContext tal cual,
// nunca se copia a estado local. El único estado local acá es el de la
// propia acción de logout (en curso / con error) — mismo contrato que ya
// ejercita auth/AuthContext.test.tsx (escenario 8, signOut fallido).
export function AppLayout() {
  const { me, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

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
      <header>
        <nav>
          <Link to="/">Plataforma CRM</Link>
          <Link to="/companies">Empresas</Link>
          <Link to="/contacts">Contactos</Link>
          <Link to="/pipelines">Pipelines</Link>
        </nav>
        <div>
          {me ? <span>{me.fullName}</span> : null}
          <button type="button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
          {logoutError ? <p role="alert">{logoutError}</p> : null}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
