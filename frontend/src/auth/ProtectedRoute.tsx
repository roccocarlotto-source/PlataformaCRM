import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Máquina de estados de acceso a rutas privadas. Deliberadamente NO redirige
// a /login para account-unavailable ni profile-error — ver
// docs de diseño de M1: un 403/5xx/network no significa "sin sesión", y
// expulsar al login en esos casos genera un loop o esconde un error
// transitorio detrás de una pantalla de login que no lo resuelve.
export function ProtectedRoute() {
  const { status, accountUnavailableReason, profileError, retryProfile } = useAuth();
  const location = useLocation();

  if (status === "initializing" || status === "loading-profile") {
    return <div>Cargando…</div>;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (status === "account-unavailable") {
    return (
      <div>
        <p>{accountUnavailableReason}</p>
      </div>
    );
  }

  if (status === "profile-error") {
    return (
      <div>
        <p>No pudimos verificar tu cuenta{profileError ? `: ${profileError.message}` : "."}</p>
        <button type="button" onClick={retryProfile}>
          Reintentar
        </button>
      </div>
    );
  }

  return <Outlet />;
}
