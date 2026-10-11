import { isAuthError } from "@supabase/supabase-js";

// Los errores de Supabase Auth (signInWithPassword, resetPasswordForEmail,
// updateUser, getUser) vienen en inglés ("Invalid login credentials", "New
// password should be different from the old password"…) y llegaban así a la
// pantalla. Esta función los pasa a castellano: primero por `code` (estable,
// lo manda GoTrue desde 2024), después por el texto (respuestas sin código,
// o versiones viejas del servidor) y, si no reconoce el error, un mensaje
// genérico en castellano — nunca el texto crudo en inglés.
//
// Un error que NO es de Supabase Auth (el ApiError de nuestro backend, un
// Error armado por nosotros) ya viene en castellano: se muestra tal cual.

export const MENSAJE_GENERICO_DE_AUTH =
  "No pudimos completar la operación. Intentá de nuevo en unos minutos.";

const SIN_CONEXION = "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.";
const DEMASIADOS_INTENTOS = "Demasiados intentos. Probá de nuevo en unos minutos.";
const ENLACE_VENCIDO = "Este enlace no es válido o expiró. Pedí uno nuevo.";
const SESION_VENCIDA = "Tu sesión expiró. Volvé a iniciar sesión o abrí de nuevo el enlace.";
const CONTRASENA_DEBIL =
  "La contraseña es demasiado débil. Elegí una más larga, que combine letras y números.";

const POR_CODIGO: Record<string, string> = {
  invalid_credentials: "El email o la contraseña no son correctos.",
  email_not_confirmed: "Todavía no confirmaste tu email. Revisá tu casilla de correo.",
  same_password: "La contraseña nueva tiene que ser distinta de la que ya tenés.",
  weak_password: CONTRASENA_DEBIL,
  over_email_send_rate_limit:
    "Ya te enviamos varios emails. Esperá unos minutos antes de pedir otro.",
  over_request_rate_limit: DEMASIADOS_INTENTOS,
  otp_expired: ENLACE_VENCIDO,
  flow_state_expired: ENLACE_VENCIDO,
  flow_state_not_found: ENLACE_VENCIDO,
  user_not_found: "No encontramos una cuenta con ese email.",
  session_not_found: SESION_VENCIDA,
  session_expired: SESION_VENCIDA,
  refresh_token_not_found: SESION_VENCIDA,
  refresh_token_already_used: SESION_VENCIDA,
  bad_jwt: SESION_VENCIDA,
  reauthentication_needed: "Por seguridad, volvé a iniciar sesión antes de cambiar la contraseña.",
  user_banned: "Tu cuenta está bloqueada. Contactá a tu administrador.",
  email_address_invalid: "El email no es válido.",
  validation_failed: "Revisá los datos ingresados e intentá de nuevo.",
  request_timeout: SIN_CONEXION,
};

// Para las respuestas que llegan sin `code`. Se compara contra el comienzo
// del texto de GoTrue, en minúsculas.
const POR_MENSAJE: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid login credentials/i, POR_CODIGO.invalid_credentials],
  [/email not confirmed/i, POR_CODIGO.email_not_confirmed],
  [/new password should be different/i, POR_CODIGO.same_password],
  [/password should (be at least|contain)/i, CONTRASENA_DEBIL],
  [/email rate limit exceeded/i, POR_CODIGO.over_email_send_rate_limit],
  [/for security purposes, you can only request this after/i, DEMASIADOS_INTENTOS],
  [/rate limit/i, DEMASIADOS_INTENTOS],
  [/email link is invalid or has expired|token has expired or is invalid/i, ENLACE_VENCIDO],
  [/user not found/i, POR_CODIGO.user_not_found],
  [/auth session missing|session not found|session expired/i, SESION_VENCIDA],
  [/unable to validate email address/i, POR_CODIGO.email_address_invalid],
  [/failed to fetch|networkerror|load failed|network request failed/i, SIN_CONEXION],
];

function porMensaje(mensaje: string): string | null {
  for (const [patron, traduccion] of POR_MENSAJE) {
    if (patron.test(mensaje)) return traduccion;
  }
  return null;
}

/**
 * El mensaje en castellano para mostrar de un error de Supabase Auth.
 * `generico` es el de la pantalla para lo que no se reconoce ("No pudimos
 * iniciar sesión", …).
 */
export function mensajeDeAuth(error: unknown, generico = MENSAJE_GENERICO_DE_AUTH): string {
  if (isAuthError(error)) {
    if (error.code && POR_CODIGO[error.code]) return POR_CODIGO[error.code];
    const traducido = porMensaje(error.message);
    if (traducido) return traducido;
    if (error.status === 429) return DEMASIADOS_INTENTOS;
    // AuthRetryableFetchError: el fetch ni llegó (status 0) o el servidor
    // respondió 5xx sin cuerpo útil.
    if (error.name === "AuthRetryableFetchError") return SIN_CONEXION;
    return generico;
  }
  if (error instanceof Error) {
    // Un error nuestro (en castellano) se muestra tal cual; uno del navegador
    // con texto en inglés conocido ("Failed to fetch"), traducido.
    return porMensaje(error.message) ?? error.message;
  }
  return generico;
}

/**
 * updateUser({ password }) rechazó la contraseña porque es la misma que la
 * cuenta ya tiene (422 same_password). Para quien solo quería que la cuenta
 * quedara con esa contraseña, no es un error: ya la tiene.
 */
export function esMismaContrasena(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isAuthError(error) && error.code === "same_password") return true;
  return /new password should be different/i.test(error.message);
}
