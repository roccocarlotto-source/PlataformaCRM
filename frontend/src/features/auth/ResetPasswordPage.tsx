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
  const { status } = useAuth();

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
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la contraseña");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (done) {
    return <Navigate to="/" replace />;
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
