import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { AuthShell } from "./AuthShell";

interface LoginLocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    // Ya sea porque el usuario navegó a /login con sesión válida, o porque
    // login() recién tuvo éxito (onAuthStateChange ya actualizó status):
    // mismo camino de redirect, sin lógica imperativa de navegación.
    const from = (location.state as LoginLocationState | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      // Éxito: no navegamos acá — el render de arriba se encarga en cuanto
      // status pase a "authenticated". isSubmitting queda en true a
      // propósito hasta que este componente deje de montarse.
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setIsSubmitting(false);
    }
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
        <FormField label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </FormField>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Ingresando…" : "Ingresar"}
        </Button>
        <p className="ds-auth-links">
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </p>
      </form>
    </AuthShell>
  );
}
