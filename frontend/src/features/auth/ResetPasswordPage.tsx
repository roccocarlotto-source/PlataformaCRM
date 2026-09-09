import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "./AuthShell";

// Misma regla real que AcceptInvitationPage.tsx (password mínimo 8) — sin
// schema propio de backend porque esta contraseña nunca pasa por Express,
// se setea directo contra Supabase. Redeclarada acá en vez de importada:
// mismo criterio que onboarding.schema.ts, cada punto de "elegir password"
// es dueño de su propia constante hasta que exista una política compartida.
const MIN_PASSWORD_LENGTH = 8;

// R1.3 — el link de recuperación (redirectTo de ForgotPasswordPage) trae un
// token que supabase-js ya consume solo (detectSessionInUrl: true, ver
// lib/supabase.ts) antes de que este componente se renderice, dejando una
// sesión real establecida para ese usuario. Por eso alcanza con mirar
// `status`: solo hace falta ALGUNA sesión (no que /api/me ya haya resuelto)
// para poder llamar a updateUser({ password }) — a diferencia de
// AcceptInvitationPage, acá no hay accept ni perfil que crear.
//
// Restyle con criterio propio (sin export): los tres estados de render
// (cargando, link inválido, formulario) en la misma tarjeta centrada
// (AuthShell). Condiciones, textos y rótulos no cambian.
export function ResetPasswordPage() {
  const { status, logout } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function validatePasswords(): string | null {
    if (password !== confirmPassword) return "Las contraseñas no coinciden";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validatePasswords();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw updateError;
      }
      // Contraseña ya guardada en Supabase: lo que sigue es best-effort, no
      // vuelve a fallar la operación si algo de esto no sale perfecto. La
      // sesión de recuperación (la misma que detectSessionInUrl estableció
      // al abrir el link, ver comentario de arriba) sigue activa acá — sin
      // este logout, el <Navigate> de abajo llevaría a "/" con esa sesión
      // todavía válida y el usuario entraría a la app sin haber vuelto a
      // loguearse. Mismo signOut({ scope: "local" }) que expone
      // AuthContext.logout(); si Supabase no confirma el cierre (offline,
      // error de red), no lo tratamos como fallo de la pantalla — la
      // contraseña ya cambió — pero tampoco lo silenciamos: si la sesión
      // sigue activa, LoginPage() ya sabe redirigir a "/" sola (mismo
      // camino que si el usuario hubiera entrado ahí con sesión válida).
      try {
        await logout();
      } catch {
        // Sesión de recuperación no se pudo cerrar server-side; se ignora
        // a propósito, ver comentario de arriba.
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la contraseña");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (done) {
    // A /login y no a "/": que el usuario vuelva a loguearse con la
    // contraseña nueva en vez de quedar autenticado automáticamente con la
    // sesión de recuperación (pedido explícito, 2026-09-09 — antes entraba
    // directo a la app sin volver a probar la contraseña).
    return <Navigate to="/login" replace />;
  }

  if (status === "initializing" || status === "loading-profile") {
    return (
      <AuthShell>
        <LoadingState />
      </AuthShell>
    );
  }

  if (status === "unauthenticated") {
    return (
      <AuthShell>
        <div>
          <ErrorState>Este enlace no es válido o expiró.</ErrorState>
          <p className="ds-auth-links">
            <Link to="/forgot-password">Solicitar un nuevo link</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1>Elegí una nueva contraseña</h1>
        <FormField label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
          />
        </FormField>
        <FormField label="Confirmar contraseña">
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            autoComplete="new-password"
          />
        </FormField>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </AuthShell>
  );
}
