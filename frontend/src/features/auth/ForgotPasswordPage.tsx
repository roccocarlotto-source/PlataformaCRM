import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "./AuthShell";

// R1.3 — solicita el link de recuperación vía Supabase Auth. Sin backend
// propio: mismo criterio ya establecido en el proyecto de no tener un
// endpoint de login/password propio (ver docs/authentication-architecture.md).
//
// Restyle con criterio propio (sin export): las dos vistas (formulario y
// "enviado") en la misma tarjeta centrada (AuthShell). Textos y rótulos no
// cambian; "Volver a iniciar sesión" sigue en las dos.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        throw resetError;
      }
      // Supabase no distingue "el email no existe" de "se envió el link" en
      // esta respuesta — a propósito, para no exponer qué emails están
      // registrados. El mensaje de éxito es siempre el mismo,
      // independientemente de si la cuenta existe.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la solicitud");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <div>
          <h1>Revisá tu email</h1>
          <p className="ds-auth-text">
            Si existe una cuenta con ese email, te enviamos un link para restablecer tu contraseña.
          </p>
          <p className="ds-auth-links">
            <Link to="/login">Volver a iniciar sesión</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1>Recuperar contraseña</h1>
        <p className="ds-auth-text">
          Ingresá tu email y te enviamos un link para elegir una nueva contraseña.
        </p>
        <FormField label="Email">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </FormField>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Enviando…" : "Enviar link"}
        </Button>
        <p className="ds-auth-links">
          <Link to="/login">Volver a iniciar sesión</Link>
        </p>
      </form>
    </AuthShell>
  );
}
