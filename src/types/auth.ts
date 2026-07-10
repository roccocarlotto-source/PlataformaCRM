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

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
