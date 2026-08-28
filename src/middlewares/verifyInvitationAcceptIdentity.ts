import type { NextFunction, Request, Response } from "express";
import { verifySupabaseJwt } from "../lib/jwt";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { extractBearerToken } from "../utils/bearerToken";

// Middleware reutilizable y acotado (M1, punto A del ciclo de rate
// limiting): verifica el JWT de Supabase UNA sola vez y deja
// { userId, email } en req.invitationAcceptIdentity para que tanto
// acceptInvitationRateLimiter (keying por identidad, ver rateLimit.ts)
// como el controller/service lo consuman sin volver a verificar el token.
// No reemplaza a authenticate.ts — ese exige una fila en public.users que
// todavía no existe para quien está aceptando (mismo motivo ya
// documentado en bearerToken.ts).
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
// COSTO: una llamada a la Admin API por intento de aceptación. Es un endpoint de
// baja frecuencia y ya rate-limiteado en dos etapas; acceptPreAuthRateLimiter
// (por IP, montado ANTES de este middleware) es el que acota cuántas de estas
// llamadas puede provocar un anónimo, y sigue corriendo primero.
export const verifyInvitationAcceptIdentity = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const payload = await verifySupabaseJwt(token);

    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(payload.sub);

    if (error || !data.user) {
      // Un `sub` con firma válida que la Admin API no resuelve: identidad
      // borrada entre la emisión del token y ahora, o un proyecto distinto. En
      // los dos casos es un 401, igual que un token inválido — no un 500, no es
      // un fallo del servidor.
      throw new AppError("No se pudo verificar la identidad del token", 401);
    }

    const usuario = data.user;

    if (!usuario.email) {
      throw new AppError("El token no contiene un email válido", 401);
    }

    if (!usuario.email_confirmed_at) {
      throw new AppError("Tenés que confirmar tu email antes de aceptar una invitación", 401);
    }

    req.invitationAcceptIdentity = {
      userId: payload.sub,
      email: usuario.email.trim().toLowerCase(),
    };

    next();
  },
);
