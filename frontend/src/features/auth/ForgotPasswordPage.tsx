import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

// R1.3 — solicita el link de recuperación vía Supabase Auth. Sin backend
// propio: mismo criterio ya establecido en el proyecto de no tener un
// endpoint de login/password propio (ver docs/authentication-architecture.md).
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
      <div>
        <h1>Revisá tu email</h1>
        <p>
          Si existe una cuenta con ese email, te enviamos un link para restablecer tu contraseña.
        </p>
        <Link to="/login">Volver a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Recuperar contraseña</h1>
      <p>Ingresá tu email y te enviamos un link para elegir una nueva contraseña.</p>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Enviando…" : "Enviar link"}
      </button>
      <p>
        <Link to="/login">Volver a iniciar sesión</Link>
      </p>
    </form>
  );
}
