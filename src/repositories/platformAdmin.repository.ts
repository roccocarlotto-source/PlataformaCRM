import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Allowlist global de operadores de la plataforma (modelo PlatformAdmin, sin
// FK a User ni a Organization — ver prisma/schema.prisma).
//
// Nació en qrBilling.repository.ts con el módulo QR (docs/qr-integration.md,
// Fase 2), porque el único consumidor era la activación manual de ese módulo.
// Con la Fase 4a del módulo SaaS (alta de organizaciones por un platform
// admin) la consulta pasa a tener dos consumidores más —requirePlatformAdmin y
// GET /api/me— que no tienen nada que ver con QR, así que vive en su propio
// repositorio. Es la MISMA consulta para todos: la identidad se re-verifica
// contra la tabla en cada llamada, nunca se confía en un estado del cliente.
//
// Sin write path de aplicación, a propósito: la única forma de agregar una
// fila es SQL directo — ver "Dar de alta el primer platform admin" en
// docs/qr-integration.md.
// ---------------------------------------------------------------------------
export function findPlatformAdminByUserId(userId: string, db: Db = prisma) {
  return db.platformAdmin.findUnique({ where: { userId } });
}
