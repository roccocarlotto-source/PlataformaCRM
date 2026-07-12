import type { NextFunction, Request, Response } from "express";
import { rateLimit, type RateLimitInfo } from "express-rate-limit";
import { acceptInvitationSchema } from "../schemas/invitation.schema";
import { onboardingSchema } from "../schemas/onboarding.schema";
import type { InvitationAcceptIdentity } from "../types/auth";
import { AppError } from "../utils/AppError";

// M1 — rate limiting a nivel Express (docs/project-overview.md §8/§9).
//
// Cada limiter se expone también como función factory (create*RateLimiter)
// además de la instancia singleton que realmente montan las rutas: los
// tests de integración usan las factories para levantar una instancia
// fresca (su propio MemoryStore) por caso, sin heredar el contador
// acumulado de otros tests ni el de las instancias de producción — mismos
// valores, misma lógica, Store aislado.
//
// Ningún limiter recibe nunca un `store` explícito ni comparte una misma
// instancia con otro: cada llamada a rateLimit(...) obtiene su propio
// MemoryStore por defecto (verificado contra la documentación oficial de
// express-rate-limit@8.5.2 — el check `unsharedStore` de la librería
// existe exactamente para detectar el caso contrario, que este diseño
// nunca produce, porque nunca se construye/pasa un `store` manualmente).
//
// Store: MemoryStore (default de la librería) — estado en memoria del
// proceso, se resetea en cada restart/deploy, NO se comparte entre
// múltiples instancias/procesos. Aceptado deliberadamente para la
// topología hoy demostrada de Plataforma CRM (proceso Node único, sin
// evidencia de réplicas — ver docs/project-overview.md). Si la topología
// pasa a múltiples instancias, esta política debe migrar a un store
// compartido (Postgres o un proveedor externo) antes de considerarse
// correcta — no es automático.
//
// trust proxy: deliberadamente sin configurar (default de Express,
// deshabilitado) — correcto para un proceso Node/Express directo, sin
// reverse proxy/load balancer documentado delante. Ningún keyGenerator de
// acá confía en X-Forwarded-For más allá de lo que Express ya decide via
// trust proxy. El día que haya un proxy real y documentado delante,
// trust proxy debe configurarse explícitamente a esa topología (nunca
// `true` a ciegas) antes de que el límite por IP vuelva a ser correcto.

// express-rate-limit@8.5.2 no aumenta globalmente Express.Request con
// `rateLimit` (a diferencia de versiones anteriores) — el nombre de la
// propiedad es configurable (`requestPropertyName`, default "rateLimit") y
// la librería expone el tipo `RateLimitInfo` para que el consumidor tipe
// el acceso él mismo.
function buildRateLimitHandler(message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
    const resetTime = info?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : 60;
    res.setHeader("Retry-After", String(retryAfterSeconds));
    next(new AppError(message, 429));
  };
}

// ---------------------------------------------------------------------------
// Onboarding — POST /api/onboarding (público, sin identidad previa).
//
// Amenaza: creación masiva automatizada de Organization + identidad real de
// Supabase Auth (email_confirm: true, sin el rate limit de envío de email
// que sí protege a Invitation), y costo en la Admin API de Supabase.
// keyGenerator: ninguno — se usa el default de la librería, que ya resuelve
// IPv4/IPv6 de forma segura (ipKeyGenerator + ipv6Subnet interno,
// verificado contra la documentación oficial de la 8.5.2).
// Cuenta solo requests con body válido según onboardingSchema: un body
// malformado nunca toca Supabase ni Postgres, así que contarlo no protege
// nada y sí penaliza a un usuario real que se equivoca de formato.
//
// Baseline operacional, no un umbral definitivo — ajustable según
// observabilidad/uso real.
// ---------------------------------------------------------------------------
export const ONBOARDING_WINDOW_MS = 15 * 60 * 1000;
export const ONBOARDING_MAX = 5;

export function createOnboardingRateLimiter() {
  return rateLimit({
    windowMs: ONBOARDING_WINDOW_MS,
    max: ONBOARDING_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => !onboardingSchema.safeParse(req.body).success,
    handler: buildRateLimitHandler(
      "Demasiados intentos de registro. Probá de nuevo más tarde.",
    ),
  });
}

export const onboardingRateLimiter = createOnboardingRateLimiter();

// ---------------------------------------------------------------------------
// Invitation accept — etapa 1: pre-auth, POST /api/invitations/accept,
// montado ANTES de verifyInvitationAcceptIdentity.
//
// Amenaza: actor completamente anónimo (sin ningún JWT válido) inundando
// la ruta con tokens basura/vencidos — cada uno paga el costo real de
// intentar verify (parseo + verificación criptográfica ES256 contra el
// JWKS), sin llegar nunca a tener un `sub`. El limiter por identidad
// (etapa 2) estructuralmente no puede mitigar esto: corre después del
// único punto donde ese costo se paga. Población: cualquiera en internet,
// misma que onboarding — a diferencia de la etapa 2, no está acotada a
// "gente invitada".
//
// Cuenta TODO request que llega, sin skip: cualquier filtro acá
// requeriría verificar primero, anulando el propósito del límite.
// keyGenerator: ninguno, mismo criterio que onboarding.
// ---------------------------------------------------------------------------
export const ACCEPT_PRE_AUTH_WINDOW_MS = 5 * 60 * 1000;
export const ACCEPT_PRE_AUTH_MAX = 20;

export function createAcceptPreAuthRateLimiter() {
  return rateLimit({
    windowMs: ACCEPT_PRE_AUTH_WINDOW_MS,
    max: ACCEPT_PRE_AUTH_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: buildRateLimitHandler(
      "Demasiados intentos. Probá de nuevo más tarde.",
    ),
  });
}

export const acceptPreAuthRateLimiter = createAcceptPreAuthRateLimiter();

// ---------------------------------------------------------------------------
// Invitation accept — etapa 2: post-auth, montado DESPUÉS de
// verifyInvitationAcceptIdentity.
//
// Amenaza: una identidad Supabase YA verificada (población acotada a gente
// invitada u onboardeada, no "cualquiera en internet") golpeando el
// endpoint repetidamente — carga de Postgres, no de CPU de verificación.
//
// keyGenerator custom por identidad verificada (userId = sub del JWT) —
// nunca usa req.ip, así que la validación de fallback-a-IP de la librería
// (ERR_ERL_KEY_GEN_IPV6, agregada en 8.0.0) no aplica acá en absoluto.
// Cuenta solo requests con identidad válida (estructural: si
// verifyInvitationAcceptIdentity falla, este limiter nunca se ejecuta) Y
// body válido según acceptInvitationSchema (skip), mismo criterio que
// onboarding.
// ---------------------------------------------------------------------------
export const ACCEPT_IDENTITY_WINDOW_MS = 10 * 60 * 1000;
export const ACCEPT_IDENTITY_MAX = 10;

function acceptInvitationKeyGenerator(req: Request): string {
  const identity = req.invitationAcceptIdentity as
    | InvitationAcceptIdentity
    | undefined;
  if (!identity) {
    // No debería poder pasar nunca: verifyInvitationAcceptIdentity corre
    // antes en la cadena y, si falla, ya cortó el request con su propio
    // 401 sin llegar acá.
    throw new Error(
      "acceptInvitationRateLimiter: falta req.invitationAcceptIdentity — verificá el orden de middlewares en invitation.routes.ts",
    );
  }
  return identity.userId;
}

export function createAcceptInvitationRateLimiter() {
  return rateLimit({
    windowMs: ACCEPT_IDENTITY_WINDOW_MS,
    max: ACCEPT_IDENTITY_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: acceptInvitationKeyGenerator,
    skip: (req) => !acceptInvitationSchema.safeParse(req.body).success,
    handler: buildRateLimitHandler(
      "Demasiados intentos. Probá de nuevo más tarde.",
    ),
  });
}

export const acceptInvitationRateLimiter = createAcceptInvitationRateLimiter();
