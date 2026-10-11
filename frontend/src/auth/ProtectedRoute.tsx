import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { LoadingScreen } from "../design-system/LoadingState";

// Máquina de estados de acceso a rutas privadas. Deliberadamente NO redirige
// a /login para account-unavailable ni profile-error — ver
// docs de diseño de M1: un 403/5xx/network no significa "sin sesión", y
// expulsar al login en esos casos genera un loop o esconde un error
// transitorio detrás de una pantalla de login que no lo resuelve.
export function ProtectedRoute() {
  const { status, accountUnavailableReason, debeAceptarInvitacion, profileError, retryProfile } =
    useAuth();
  const location = useLocation();

  if (status === "initializing" || status === "loading-profile") {
    return <LoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // El link del mail de una invitación vieja (o el Site URL de Supabase)
  // deja una sesión sin usuario: se la lleva a aceptar la invitación, que es
  // lo que crea el usuario. Una cuenta desactivada o removida sigue viendo su
  // aviso (otro código de error).
  if (status === "account-unavailable" && debeAceptarInvitacion) {
    return <Navigate to="/invite/accept" replace />;
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
