import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySupabaseJwt } from "../lib/jwt";
import { logger } from "../lib/logger";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { acceptInvitationSchema } from "../schemas/invitation.schema";
import type { JwtPayload } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { extractBearerToken } from "../utils/bearerToken";
import { parseOrThrow } from "../utils/validation";
import { acceptInvitationRateLimiter } from "./rateLimit";

// La verificación de identidad para POST /api/invitations/accept (M1, punto A
// del ciclo de rate limiting), en DOS etapas desde V-8 de
// docs/auditoria-2026-08-29.md — antes era un solo middleware:
//
//   1. verifyInvitationAcceptToken: verifica la firma del JWT de Supabase
//      (barato: JWKS cacheado, sin red a Supabase) y deja el `sub` en
//      req.invitationAcceptSubject.
//   2. resolveInvitationAcceptIdentity: resuelve ese `sub` contra la Admin API
//      (caro: una llamada HTTP a Supabase por request) y deja { userId, email }
//      en req.invitationAcceptIdentity para el controller/service.
//
// Entre las dos corre acceptInvitationRateLimiter, keyeando por el `sub` de la
// etapa 1 — ver crearCadenaDeAceptacion al final del archivo, que es lo ÚNICO
// que invitation.routes.ts monta. No reemplaza a authenticate.ts — ese exige
// una fila en public.users que todavía no existe para quien está aceptando
// (mismo motivo ya documentado en bearerToken.ts).
//
// ---------------------------------------------------------------------------
// ALTO-3 — el claim `email` del JWT dejó de ser la credencial
// ---------------------------------------------------------------------------
//
// El email era la credencial COMPLETA para unirse a una organización con el rol
// que trajera la invitación (invitation.service.ts compara
// `invitation.email !== email`), y este middleware lo tomaba del claim del token
// sin mirar nunca `email_verified` ni `email_confirmed_at`.
//
// Eso apoyaba la seguridad de todo el flujo en un toggle del panel de Supabase
// ("Confirm email") que el repositorio NO CONTROLA, NO DOCUMENTA Y NO VERIFICA.
// Con ese toggle apagado —o apagado un rato para depurar— cualquiera hacía
// POST /auth/v1/signup con el email del invitado, recibía una sesión ES256
// perfectamente válida, y aceptaba la invitación ajena. El JWT no tenía nada de
// malo: la firma, el emisor, la expiración y el JWKS estaban y siguen estando
// bien. Lo que faltaba era preguntar si ese email había sido probado.
//
// SE ADOPTA LA OPCIÓN (B) DEL HALLAZGO, la que la auditoría marca como
// recomendada: resolver la identidad con
// `supabaseAdmin.auth.admin.getUserById(payload.sub)` y decidir con
// `email_confirmed_at`. La opción (A) —exigir issuer/audience en jwtVerify y
// confiar en el claim `email_verified`— se descartó por lo que la auditoría
// misma anota: si Supabase cambia el formato de `iss`, rompe el login de golpe.
//
// EL EMAIL AHORA SALE DE LA ADMIN API, NO DEL TOKEN, y no es un detalle: un
// claim es una afirmación del emisor congelada en el momento de emisión, y acá
// se está decidiendo una pertenencia a organización. La fuente de verdad es
// auth.users.
//
// COSTO: una llamada a la Admin API por intento de aceptación, y QUIÉN PUEDE
// PROVOCARLA es lo que V-8 (docs/auditoria-2026-08-29.md) corrigió. La firma
// del JWT se verifica ANTES de getUserById, así que un anónimo con tokens
// basura muere en el 401 de verifySupabaseJwt sin llegar nunca a Supabase —
// eso ya era así. Lo que NO era así, aunque el comentario anterior lo
// afirmara: el limiter por identidad corría DESPUÉS de este middleware
// entero, o sea después de la llamada a la Admin API, en cada request. Una
// identidad real con el cupo agotado seguía provocando una llamada por
// request; el 429 solo le ahorraba el handler. Y esa identidad no es "gente
// invitada": el registro público (requestOnboardingOtp/onboardOrganization,
// onboarding.service.ts) le da a cualquiera una cuenta confirmada y un JWT
// válido, e invitation.service.ts recién pregunta si existe una invitación
// para ese email DESPUÉS de toda esta cadena. Desde V-8 el limiter corre entre
// la verificación de firma y la Admin API, con el `sub` verificado como
// clave: una identidad con el cupo agotado no llega a Supabase. (Hasta el
// 29/08 había además un limiter por IP antes de todo esto; se sacó en A-2 —
// ver rateLimit.ts.)
//
// ---------------------------------------------------------------------------
// QUÉ CIERRA ESTO Y QUÉ NO — corregido después de verificarlo contra GoTrue
// ---------------------------------------------------------------------------
//
// CIERRA: que la decisión dependa de un CLAIM. El email sale de auth.users, no
// de una afirmación del emisor congelada al emitir el token, y la confirmación
// se COMPRUEBA en vez de suponerse. Una identidad con token válido y sin
// confirmar es rechazada acá.
//
// NO CIERRA: la necesidad de que "Confirm email" esté ENCENDIDO en el proyecto.
// Con el toggle apagado GoTrue autoconfirma en el alta, así que el atacante del
// escenario de ALTO-3 —signup con el email del invitado— termina con
// email_confirmed_at PUESTO, y ningún chequeo de backend puede distinguir esa
// confirmación automática de una real.
//
// Y un dato que apareció al escribir los tests, no al diseñar: GoTrue NUNCA
// emite sesión para una identidad sin confirmar, con el toggle en cualquier
// estado. O sea que "token válido + email sin confirmar" no es alcanzable por
// los caminos normales de Supabase. Esta comprobación es, entonces, defensa en
// profundidad —vale para cualquier token que no venga del camino feliz— y no un
// reemplazo del toggle, que docs/supabase-setup.md sigue exigiendo.
// Lo único que este archivo DECIDE, separado de la red que lo alimenta.
//
// Extraído a una función pura por un motivo concreto, no por prolijidad: la
// rama de "sin confirmar" NO SE PUEDE EJERCITAR contra un Supabase real, porque
// GoTrue no emite sesión para una identidad sin confirmar. Un test de
// integración no puede construir la premisa "token válido + email sin
// confirmar" y termina salteándose — que es exactamente como esta rama estuvo
// sin una sola aserción hasta que el conteo de skips del CI lo delató.
//
// Con la decisión separada, verifyInvitationAcceptIdentity.test.ts la cubre
// entera sin red ni base, y el test de integración queda para lo que sí puede
// probar: que el cableado real (JWT -> Admin API -> request) funciona.
export interface IdentidadDeAuth {
  email?: string;
  email_confirmed_at?: string | null;
}

export function resolverIdentidadDeInvitacion(
  userId: string,
  usuario: IdentidadDeAuth | null | undefined,
): { userId: string; email: string } {
  if (!usuario) {
    // Un `sub` con firma válida que la Admin API no resuelve: identidad borrada
    // entre la emisión del token y ahora, o un proyecto distinto. En los dos
    // casos es un 401, igual que un token inválido — no un 500, no es un fallo
    // del servidor.
    throw new AppError("No se pudo verificar la identidad del token", 401);
  }

  if (!usuario.email) {
    throw new AppError("El token no contiene un email válido", 401);
  }

  if (!usuario.email_confirmed_at) {
    throw new AppError("Tenés que confirmar tu email antes de aceptar una invitación", 401);
  }

  return { userId, email: usuario.email.trim().toLowerCase() };
}

// ---------------------------------------------------------------------------
// A-3 (docs/auditoria-2026-08-29.md) — "la Admin API no encontró al usuario" y
// "la Admin API no respondió" NO SON EL MISMO 401.
//
// Antes, cualquier `error` de getUserById se descartaba sin log y se pasaba
// `null` a resolverIdentidadDeInvitacion, que responde 401 "No se pudo
// verificar la identidad del token". Con Supabase caído, con la red cortada o
// con un 5xx de GoTrue, el invitado veía su credencial como inválida y el
// servidor no dejaba ni una línea que dijera qué pasó.
//
// LA DISTINCIÓN, VERIFICADA CONTRA @supabase/auth-js@2.110.2 (lib/fetch.js
// handleError y GoTrueAdminApi.getUserById), no asumida:
//
//   - fetch que ni siquiera responde (red, DNS, timeout) → AuthRetryableFetchError
//     con status 0;
//   - respuesta 5xx de GoTrue → AuthRetryableFetchError con ese status;
//   - cualquier otro status HTTP → AuthApiError con `status` y `code`. El
//     usuario inexistente es un 404 (`user_not_found`).
//   - getUserById atrapa todo lo que sea AuthError y lo devuelve como `error`
//     en vez de lanzarlo; lo que no es AuthError (un bug) sí se propaga y cae
//     en errorHandler como 500, que es lo correcto.
//
// Así que "no existe" es exactamente `AuthApiError` + 404, y todo lo demás
// —incluido un 401/403 de la Admin API, que significa que la service role key
// de ESTE servidor está mal, no que el invitado sea quien dice ser— es un
// fallo nuestro o de Supabase: 503 y el error original al log. 503 y no 500
// por el mismo criterio que el webhook de Google Calendar y /health: fallo
// transitorio, no es culpa de quien llama, conviene reintentar.
// ---------------------------------------------------------------------------

// La forma mínima del error que devuelve auth-js, para no atar la decisión
// (ni su test) a la clase concreta: `isAuthApiError` de la librería compara
// por `name`, así que esto hace lo mismo con una superficie explícita.
export interface ErrorDeAdminApi {
  name?: string;
  status?: number;
  message?: string;
}

// Exportada para fijarla con tests unitarios sin red, igual que
// resolverIdentidadDeInvitacion: es la decisión, separada de la red que la
// alimenta.
export function esUsuarioInexistente(error: ErrorDeAdminApi): boolean {
  return error.name === "AuthApiError" && error.status === 404;
}

// ---------------------------------------------------------------------------
// Las dos etapas, con sus dependencias inyectables — mismo criterio que
// verifySupabaseJwtWith en lib/jwt.ts y el `fetch` del cliente de Google: lo
// que se quiere fijar con un test es el ORDEN de la cadena (que el cupo se
// consuma antes de la Admin API), y eso se prueba sin red reemplazando la
// verificación de firma y la Admin API por dobles que cuentan llamadas.
// ---------------------------------------------------------------------------

export type VerificarJwt = (token: string) => Promise<JwtPayload>;

// La forma mínima de admin.getUserById: la unión que devuelve auth-js
// ({ data: { user }, error: null } | { data: { user: null }, error }) es
// asignable a esto sin adaptar nada.
export type ObtenerUsuarioDeAuth = (
  userId: string,
) => Promise<{ data: { user: IdentidadDeAuth | null }; error: ErrorDeAdminApi | null }>;

// Etapa 1 — firma del JWT, sin red a Supabase. Deja el `sub` verificado para
// que el limiter keyee por él.
export function crearVerifyInvitationAcceptToken(verificarJwt: VerificarJwt) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const payload = await verificarJwt(token);
    req.invitationAcceptSubject = { userId: payload.sub };
    next();
  });
}

// Etapa 2 — la Admin API, ya con el cupo por identidad consumido. Toda la
// clasificación de errores de A-3 vive acá, sin cambios.
export function crearResolveInvitationAcceptIdentity(obtenerUsuario: ObtenerUsuarioDeAuth) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const subject = req.invitationAcceptSubject;
    if (!subject) {
      // No debería poder pasar nunca: verifyInvitationAcceptToken corre antes
      // en la cadena y, si falla, ya cortó el request con su propio 401.
      throw new Error(
        "resolveInvitationAcceptIdentity: falta req.invitationAcceptSubject — verificá el orden de crearCadenaDeAceptacion",
      );
    }

    const { data, error } = await obtenerUsuario(subject.userId);

    if (error && !esUsuarioInexistente(error)) {
      logger.error(
        { err: error, status: error.status, userId: subject.userId },
        "La Admin API de Supabase no pudo resolver la identidad (no es 'usuario inexistente'): se responde 503, no 401",
      );
      throw new AppError(
        "No se pudo verificar la identidad en este momento. Probá de nuevo en unos segundos.",
        503,
      );
    }

    req.invitationAcceptIdentity = resolverIdentidadDeInvitacion(
      subject.userId,
      error ? null : data.user,
    );

    next();
  });
}

export const verifyInvitationAcceptToken = crearVerifyInvitationAcceptToken(verifySupabaseJwt);

export const resolveInvitationAcceptIdentity = crearResolveInvitationAcceptIdentity((userId) =>
  getSupabaseAdmin().auth.admin.getUserById(userId),
);

// El body se valida ANTES del limiter y de la Admin API, y no es redundancia
// con el parseOrThrow del handler: acceptInvitationRateLimiter NO CUENTA los
// requests con body inválido (skip, para que un body roto no consuma cupo),
// así que sin esta etapa un body inválido pasaría el limiter sin contar y
// llegaría igual a getUserById — cupo infinito sobre la Admin API con solo
// mandar JSON malformado. Acá muere en el 400 que el handler le habría dado
// de todos modos, con el mismo schema y el mismo mensaje.
const exigirBodyValido: RequestHandler = (req, _res, next) => {
  parseOrThrow(acceptInvitationSchema, req.body);
  next();
};

export interface DependenciasDeAceptacion {
  verificarJwt: VerificarJwt;
  obtenerUsuario: ObtenerUsuarioDeAuth;
  limiter: RequestHandler;
}

// LA CADENA COMPLETA, EN EL ORDEN QUE V-8 EXIGE — y el único lugar donde ese
// orden está escrito. invitation.routes.ts monta cadenaDeAceptacionDeInvitacion
// tal cual; los tests construyen la misma función con dobles. Si el orden se
// cambia acá, el test unitario del orden lo dice; si alguien monta las etapas
// a mano en otro orden, resolveInvitationAcceptIdentity y el keyGenerator del
// limiter fallan ruidosos por falta de req.invitationAcceptSubject.
//
//   firma del JWT (401 barato)  →  body válido (400 barato)
//     →  limiter por `sub` (429, sin tocar Supabase)
//       →  Admin API (la única llamada cara, ya dentro del cupo)
export function crearCadenaDeAceptacion(deps: Partial<DependenciasDeAceptacion> = {}) {
  const verificarJwt = deps.verificarJwt ?? verifySupabaseJwt;
  const obtenerUsuario =
    deps.obtenerUsuario ?? ((userId: string) => getSupabaseAdmin().auth.admin.getUserById(userId));
  const limiter = deps.limiter ?? acceptInvitationRateLimiter;

  return [
    crearVerifyInvitationAcceptToken(verificarJwt),
    exigirBodyValido,
    limiter,
    crearResolveInvitationAcceptIdentity(obtenerUsuario),
  ] satisfies RequestHandler[];
}

export const cadenaDeAceptacionDeInvitacion = crearCadenaDeAceptacion();
