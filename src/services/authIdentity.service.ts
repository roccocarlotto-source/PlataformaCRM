import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Piezas compartidas por los flujos que crean una identidad en Supabase Auth
// y después una fila en public.users: el registro público (onboarding.service),
// la invitación a una organización existente (invitation.service) y el alta de
// una organización por un platform admin (organizationAdmin.service).
//
// Antes cada uno tenía su copia. Se juntan acá porque son exactamente la misma
// decisión en los tres —qué hacer con una identidad que quedó sin perfil de
// negocio, y cómo reconocer que GoTrue rechazó un email por duplicado— y una
// divergencia futura entre copias sería un bug silencioso en una de las tres.
// ---------------------------------------------------------------------------

// Compensación: borra la identidad de auth.users cuando la escritura de
// negocio que la justificaba falló. Best-effort y NUNCA lanza — si el borrado
// también falla, lo único que se puede hacer es dejar el id en el log para
// limpieza manual; el error que sube al cliente tiene que ser el original, no
// este.
//
// `contexto` va al mensaje de log para que la limpieza manual sepa de qué
// flujo salió el huérfano. El cliente de Admin API se recibe como parámetro y
// no se resuelve acá con getSupabaseAdmin() para que los services que lo
// inyectan (organizationAdmin.service) puedan probarse sin Supabase.
export async function revertirIdentidad(
  admin: SupabaseClient,
  authUserId: string,
  contexto: string,
): Promise<void> {
  try {
    await admin.auth.admin.deleteUser(authUserId);
  } catch (cleanupErr) {
    logger.error(
      { err: cleanupErr, orphanedAuthUserId: authUserId },
      `No se pudo revertir el usuario de Supabase Auth tras un fallo en ${contexto} — requiere limpieza manual`,
    );
  }
}

// ¿GoTrue rechazó inviteUserByEmail porque ese email ya es una identidad
// confirmada? El email de auth.users es único en todo el proyecto, no por
// organización.
//
// B-22: la señal primaria es error.code — "email_exists" es lo que devuelve
// GoTrue real para este caso (verificado empíricamente, 2.x). Antes se decidía
// por status === 422, pero GoTrue responde 422 para varias validaciones que no
// son duplicado, y cualquiera de ellas se convertía en un 409 falso. El regex
// sobre message queda como señal secundaria conservadora, por si algún GoTrue
// viejo no mandara code en este camino — con el "been" opcional, porque el
// mensaje real es "already been registered".
export function esErrorDeEmailDuplicado(authError: AuthError | null | undefined): boolean {
  return (
    authError?.code === "email_exists" ||
    /already (been )?registered|already exists/i.test(authError?.message ?? "")
  );
}
