import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../lib/supabase";
import { acceptInvitation } from "./acceptInvitationApi";

// Misma regla real que existe hoy en el proyecto para "elegir una
// contraseña" (onboarding.schema.ts: password mínimo 8 — no existe un
// schema equivalente para accept, porque el password de accept nunca pasa
// por nuestro backend, se setea directo contra Supabase). La autoridad real
// sigue siendo la política de contraseña configurada en el proyecto de
// Supabase — esto es una validación de cortesía, no la defensa real.
const MIN_PASSWORD_LENGTH = 8;

// Bookkeeping puramente local: recuerda, DENTRO de esta pestaña, que la
// aceptación backend ya tuvo éxito para un email — nunca una suposición
// sobre el estado del servidor. Sobrevive a un F5 (sessionStorage), se
// pierde si se cierra la pestaña/navegador — limitación real documentada
// en el informe (sección I), no resuelta con una heurística.
const PENDING_PASSWORD_KEY = "m7-invite-accept-pending-password";

function readPendingPasswordMarker(): string | null {
  try {
    return sessionStorage.getItem(PENDING_PASSWORD_KEY);
  } catch {
    return null;
  }
}
function setPendingPasswordMarker(email: string) {
  try {
    sessionStorage.setItem(PENDING_PASSWORD_KEY, email);
  } catch {
    // sessionStorage puede no estar disponible (modo privado estricto) — es
    // una mejora de UX, nunca la fuente de verdad; su ausencia no rompe el
    // flujo principal.
  }
}
function clearPendingPasswordMarker() {
  try {
    sessionStorage.removeItem(PENDING_PASSWORD_KEY);
  } catch {
    // ver arriba.
  }
}

// Máquina de estados explícita, sin librería: cada paso solo puede repetir
// su propia operación, nunca la de un paso anterior ya exitoso — es la
// corrección de diseño pedida sobre la secuencia original (accept SIEMPRE
// antes que updateUser({password}), nunca al revés).
type Step =
  | "form" // fullName + password + confirm, primera vez — submit -> accept
  | "accepting" // POST /invitations/accept en curso
  | "accept-failed" // accept falló — reintentar es seguro, todavía no se creó nada
  | "password-only" // recuperado tras F5 (accept ya tuvo éxito antes) — solo password + confirm
  | "setting-password" // supabase.auth.updateUser en curso
  | "password-failed" // accept OK, password falló — reintentar SOLO password
  | "resolving-profile" // retryProfile() en curso — esperando que status pase a authenticated
  | "profile-failed" // accept + password OK, la resolución de /api/me falló — reintentar SOLO profile
  | "done";

export function AcceptInvitationPage() {
  const { status, me, retryProfile } = useAuth();

  const [step, setStep] = useState<Step>("form");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationId, setInvitationId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [alreadyLoggedInEmail, setAlreadyLoggedInEmail] = useState<string | null>(null);

  // Se evalúa UNA sola vez, y solo si el flujo propio todavía no arrancó
  // (step === "form"): evita que la propia transición a "authenticated" que
  // provoca ESTE flujo al terminar (ver runSetPassword/resolving-profile)
  // se reinterprete como "sesión ajena preexistente" o como "hay que volver
  // a pedir password".
  const hasCheckedInitialSessionRef = useRef(false);

  useEffect(() => {
    if (hasCheckedInitialSessionRef.current) return;
    if (step !== "form") return;
    if (status !== "authenticated" || !me) return;
    hasCheckedInitialSessionRef.current = true;

    const pendingEmail = readPendingPasswordMarker();
    if (pendingEmail && pendingEmail === me.email) {
      // Recarga real ocurrida después de un accept exitoso: la fila
      // pública ya existe (por eso status ya es "authenticated"), pero
      // todavía no sabemos si la contraseña llegó a configurarse. No se
      // repite accept — se pide contraseña directamente.
      setStep("password-only");
    } else {
      setAlreadyLoggedInEmail(me.email);
    }
  }, [status, me, step]);

  // retryProfile() no devuelve una promesa útil (AuthContext.tsx: solo hace
  // meQuery.refetch()) — el resultado se observa acá, vía la transición
  // real de `status`. resolvingBaselineStatusRef guarda el status vigente
  // en el instante exacto en que se pide ESTE intento de resolución
  // (primero automático tras password, o el de un retry manual) — sin
  // esto, un reintento manual desde "profile-failed" (status ya en
  // "profile-error" ANTES de que la nueva consulta siquiera empiece) leía
  // ese mismo valor todavía no actualizado y volvía a "profile-failed" de
  // inmediato, ignorando el éxito real que llegaba después (bug real,
  // detectado durante el testing, no solo un artefacto de test).
  // "authenticated" nunca es ambiguo (antes de este efecto el status nunca
  // fue "authenticated"), así que se acepta sin comparar contra la
  // baseline.
  const resolvingBaselineStatusRef = useRef<typeof status | null>(null);

  useEffect(() => {
    if (step !== "resolving-profile") return;
    if (status === "authenticated") {
      setStep("done");
    } else if (status === "profile-error" && status !== resolvingBaselineStatusRef.current) {
      setStep("profile-failed");
    }
    // "account-unavailable" no debería persistir acá (accept ya escribió en
    // la misma Postgres que /api/me lee) — si ocurriera, profile-error lo
    // cubre igual en el siguiente ciclo de la query.
  }, [step, status]);

  function validatePasswords(): string | null {
    if (password !== confirmPassword) return "Las contraseñas no coinciden";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
    }
    return null;
  }

  async function runAccept() {
    setStep("accepting");
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const metadataInvitationId = data.user?.user_metadata?.invitationId as string | undefined;
      const resolvedInvitationId = invitationId ?? metadataInvitationId;
      setInvitationId(resolvedInvitationId);

      await acceptInvitation({ fullName, invitationId: resolvedInvitationId });

      // Punto de no-retorno: Invitation ACCEPTED y User ya creados del lado
      // del backend. A partir de acá ningún camino de error vuelve a llamar
      // a acceptInvitation.
      if (data.user?.email) {
        setPendingPasswordMarker(data.user.email);
      }
      await runSetPassword();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar la invitación");
      setStep("accept-failed");
    }
  }

  async function runSetPassword() {
    setStep("setting-password");
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw updateError;
      }
      clearPendingPasswordMarker();
      resolvingBaselineStatusRef.current = status;
      setStep("resolving-profile");
      retryProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo configurar la contraseña");
      setStep("password-failed");
    }
  }

  function handleRetryProfile() {
    resolvingBaselineStatusRef.current = status;
    setStep("resolving-profile");
    setError(null);
    retryProfile();
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validatePasswords();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    await runAccept();
  }

  async function handlePasswordOnlySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validatePasswords();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    // Recuperación tras F5: accept ya ocurrió antes de esta pestaña actual
    // — nunca se llama a acceptInvitation acá.
    await runSetPassword();
  }

  // Calculado antes de los early-return: lo necesita también la rama
  // "alreadyLoggedInEmail" de abajo (recuperación sin marcador de
  // sessionStorage, ver esa rama).
  const isBusy =
    step === "accepting" || step === "setting-password" || step === "resolving-profile";

  if (status === "initializing" || status === "loading-profile") {
    return <p>Cargando…</p>;
  }

  if (status === "unauthenticated") {
    return (
      <p role="alert">
        Este enlace no es válido o expiró. Pedile a tu administrador que te reinvite.
      </p>
    );
  }

  if (status === "profile-error" && step === "form") {
    return (
      <div>
        <p role="alert">No pudimos verificar tu sesión.</p>
        <button type="button" onClick={handleRetryProfile}>
          Reintentar
        </button>
      </div>
    );
  }

  if (alreadyLoggedInEmail && step === "form") {
    // La sesión de Supabase persiste en localStorage (persistSession: true,
    // sin `storage` custom en lib/supabase.ts — a diferencia del marcador
    // de recuperación de arriba, que usa sessionStorage y no sobrevive
    // cerrar la pestaña/el navegador). Por eso este caso NO distingue "es
    // otra cuenta" de "soy yo, cerré el navegador antes de terminar la
    // contraseña" — no hay forma fiable de saberlo (ver informe de
    // investigación del riesgo residual). Se ofrecen las dos salidas
    // reales sin inventar detección: cerrar sesión si no es la cuenta
    // correcta, o (re)configurar la contraseña de la sesión ya
    // autenticada — misma operación segura e idempotente que el resto del
    // flujo (supabase.auth.updateUser), sin nuevo endpoint ni heurística
    // sobre si ya tiene contraseña.
    return (
      <div>
        <p>
          Ya iniciaste sesión como {alreadyLoggedInEmail}. Si esta invitación es para otra cuenta,
          cerrá sesión primero.
        </p>
        <p>
          Si cerraste el navegador antes de terminar de configurar tu contraseña, podés hacerlo
          ahora sin perder tu cuenta.
        </p>
        <form onSubmit={handlePasswordOnlySubmit}>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirmar contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={isBusy}>
            {isBusy ? "Procesando…" : "Configurar contraseña"}
          </button>
        </form>
      </div>
    );
  }

  if (step === "done") {
    return <Navigate to="/" replace />;
  }

  if (step === "accept-failed") {
    return (
      <div>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void runAccept()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (step === "password-failed") {
    return (
      <div>
        <p role="alert">{error}</p>
        <p>Tu cuenta ya fue creada. Solo falta configurar tu contraseña.</p>
        <button type="button" onClick={() => void runSetPassword()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (step === "profile-failed") {
    return (
      <div>
        <p role="alert">No pudimos confirmar tu perfil{error ? `: ${error}` : "."}</p>
        <button type="button" onClick={handleRetryProfile}>
          Reintentar
        </button>
      </div>
    );
  }

  if (step === "password-only") {
    return (
      <form onSubmit={handlePasswordOnlySubmit}>
        <h1>Configurá tu contraseña</h1>
        <p>Tu cuenta ya fue creada. Solo falta que definas una contraseña.</p>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirmar contraseña
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            autoComplete="new-password"
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={isBusy}>
          {isBusy ? "Procesando…" : "Guardar contraseña"}
        </button>
      </form>
    );
  }

  // step: "form" | "accepting" | "setting-password" | "resolving-profile"
  return (
    <form onSubmit={handleFormSubmit}>
      <h1>Completá tu cuenta</h1>
      <label>
        Nombre completo
        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          maxLength={255}
        />
      </label>
      <label>
        Contraseña
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </label>
      <label>
        Confirmar contraseña
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          autoComplete="new-password"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isBusy}>
        {isBusy ? "Procesando…" : "Completar registro"}
      </button>
    </form>
  );
}
