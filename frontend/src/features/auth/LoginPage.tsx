import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { mensajeDeAuth } from "../../auth/mensajesDeAuth";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { PasswordField } from "../../design-system/PasswordField";
import { AuthShell } from "./AuthShell";

interface LoginLocationState {
  from?: { pathname: string };
}

// Si después de un login exitoso la sesión no llega nunca a esta pestaña
// (el evento de supabase-js no dispara), el botón no se queda girando para
// siempre. Solo cuenta mientras no hay sesión: con la sesión ya puesta,
// /api/me puede tardar lo que tarde (un backend que arranca en frío) y
// termina siempre en éxito o en error.
const ESPERA_MAXIMA_DE_LA_SESION_MS = 10_000;

const MENSAJE_CUENTA_NO_DISPONIBLE =
  "Tu cuenta todavía no está activada. Contactá a tu administrador.";

export function LoginPage() {
  const {
    status,
    login,
    accountUnavailableReason,
    debeAceptarInvitacion,
    profileError,
    retryProfile,
  } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // login() ya tuvo éxito y se espera a que AuthContext resuelva el perfil.
  // Lo que pase después (authenticated, 403, error) se deriva en el render.
  const [esperandoPerfil, setEsperandoPerfil] = useState(false);
  const [sesionNoLlego, setSesionNoLlego] = useState(false);

  const sinSesionTodavia = status === "unauthenticated" || status === "initializing";

  useEffect(() => {
    if (!esperandoPerfil || !sinSesionTodavia) return;
    const timer = setTimeout(() => setSesionNoLlego(true), ESPERA_MAXIMA_DE_LA_SESION_MS);
    return () => clearTimeout(timer);
  }, [esperandoPerfil, sinSesionTodavia]);

  if (status === "authenticated") {
    // Ya sea porque el usuario navegó a /login con sesión válida, o porque
    // login() recién tuvo éxito (onAuthStateChange ya actualizó status):
    // mismo camino de redirect, sin lógica imperativa de navegación.
    const from = (location.state as LoginLocationState | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  if (status === "account-unavailable" && debeAceptarInvitacion) {
    // Una persona invitada que todavía no aceptó (403 CUENTA_NO_ACTIVADA y
    // una sesión con invitationId): mismo destino que en ProtectedRoute —
    // aceptar la invitación es lo que le crea el usuario. Ya ingresó con su
    // contraseña, así que /invite/accept solo le pide el nombre.
    return <Navigate to="/invite/accept" replace />;
  }

  // El resultado del intento, derivado de lo que resolvió AuthContext. Solo
  // cuenta después de un login de esta pantalla: quien entra a /login con una
  // sesión vieja en ese estado no ve un error que no provocó.
  const cuentaNoDisponible = esperandoPerfil && status === "account-unavailable";
  const perfilFallo = esperandoPerfil && status === "profile-error";
  const sesionAgotada = esperandoPerfil && sinSesionTodavia && sesionNoLlego;
  const enCurso =
    isSubmitting || (esperandoPerfil && !cuentaNoDisponible && !perfilFallo && !sesionAgotada);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setEsperandoPerfil(false);
    setSesionNoLlego(false);
    try {
      await login(email, password);
      // Éxito: no navegamos acá — el render de arriba se encarga en cuanto
      // status pase a "authenticated" (o a la invitación pendiente). Si el
      // perfil termina en 403 o en error, el render lo muestra y libera el
      // botón.
      setEsperandoPerfil(true);
    } catch (err) {
      setError(mensajeDeAuth(err, "No pudimos iniciar sesión. Intentá de nuevo."));
    } finally {
      setIsSubmitting(false);
    }
  }

  let mensajeDeError: string | null = error;
  if (!mensajeDeError && cuentaNoDisponible) {
    mensajeDeError = accountUnavailableReason ?? MENSAJE_CUENTA_NO_DISPONIBLE;
  } else if (!mensajeDeError && sesionAgotada) {
    mensajeDeError = "No pudimos completar el ingreso. Intentá de nuevo.";
  }

  // Restyle con criterio propio (sin export): tarjeta centrada (AuthShell) con
  // las piezas del sistema. Rótulos, textos y el redirect de arriba no cambian.
  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1>Iniciar sesión</h1>
        <FormField label="Email">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </FormField>
        <PasswordField
          label="Contraseña"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
        />
        {mensajeDeError ? <ErrorState>{mensajeDeError}</ErrorState> : null}
        {!mensajeDeError && perfilFallo ? (
          <ErrorState onRetry={retryProfile}>
            No pudimos verificar tu cuenta
            {profileError ? `: ${mensajeDeAuth(profileError)}` : "."}
          </ErrorState>
        ) : null}
        <Button type="submit" variant="primary" disabled={enCurso} loading={enCurso}>
          {enCurso ? "Ingresando…" : "Ingresar"}
        </Button>
        <p className="ds-auth-links">
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </p>
      </form>
    </AuthShell>
  );
}
