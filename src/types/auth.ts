import type { Request } from "express";

// Catálogo de roles soportado hoy. Coincide con los valores esperados en la
// columna Role.name (string en la DB, no un enum de Postgres) — ver isRoleName().
export type RoleName = "ADMIN" | "USER";

const KNOWN_ROLES: readonly RoleName[] = ["ADMIN", "USER"];

export function isRoleName(value: string): value is RoleName {
  return (KNOWN_ROLES as readonly string[]).includes(value);
}

// Únicos claims del JWT de Supabase en los que este backend confía (principio
// rector de docs/authentication-architecture.md): identidad, no autorización.
export interface JwtPayload {
  sub: string;
  email?: string;
  exp: number;
  iat?: number;
  aud?: string | string[];
}

// Resultado de resolver el JWT contra Postgres — lo único que el resto de la
// aplicación debe usar para tomar decisiones de autorización.
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: RoleName;
  email: string;
  fullName: string;
}

// Para controllers que corren después de `authenticate`: `auth` ya no es
// opcional, evita non-null assertions en cada handler protegido.
export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

// El `sub` de un JWT de Supabase con firma verificada, ANTES de resolverlo
// contra la Admin API — V-8 de docs/auditoria-2026-08-29.md. Es lo único que
// acceptInvitationRateLimiter necesita para keyear, y existe como dato
// separado justamente para que el limiter pueda correr antes de la llamada
// cara (getUserById) y no después. Adjuntado por verifyInvitationAcceptToken.
export interface InvitationAcceptSubject {
  userId: string;
}

// Identidad Supabase verificada para el flujo de aceptación de
// invitaciones (M1) — no confundir con AuthContext: acá todavía no existe
// fila en public.users, así que no hay organizationId/role que resolver.
// Adjuntada por resolveInvitationAcceptIdentity (Admin API, ya con el cupo
// por identidad consumido), consumida por el controller/service.
export interface InvitationAcceptIdentity {
  userId: string;
  email: string;
}

// Para controllers que corren después de `resolveInvitationAcceptIdentity`.
export interface InvitationAcceptRequest extends Request {
  invitationAcceptIdentity: InvitationAcceptIdentity;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentar Express.Request EXIGE namespace: así lo declaran los propios @types/express y no hay equivalente con módulos ES.
  namespace Express {
    interface Request {
      auth?: AuthContext;
      invitationAcceptSubject?: InvitationAcceptSubject;
      invitationAcceptIdentity?: InvitationAcceptIdentity;
    }
  }
}
