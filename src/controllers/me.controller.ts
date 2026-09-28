import type { Response } from "express";
import { findPlatformAdminByUserId } from "../repositories/platformAdmin.repository";
import { findUserById } from "../repositories/user.repository";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";

// Serializa req.auth (ya resuelto por el middleware authenticate contra
// Postgres, ver src/services/auth.service.ts) al contrato HTTP de
// GET /api/me. No valida input (el endpoint no recibe ninguno).
//
// isPlatformAdmin (Fase 4a del módulo SaaS) y canUseInternalAgent (ítem 180)
// son las ÚNICAS consultas propias de este controller, y van acá y no en
// AuthContext a propósito: resolverlas en `authenticate` las cobraría en cada
// request de la API, cuando el único que las necesita es el frontend, una vez
// por sesión, para mostrar u ocultar un link. isPlatformAdmin es la misma
// consulta que requirePlatformAdmin (platformAdmin.repository.ts) y
// canUseInternalAgent el mismo criterio que requireInternalAgentAccess (ADMIN
// siempre, sin lectura; USER según la columna) — la autorización real sigue
// siendo esos middlewares en cada llamada, nunca estos booleanos.
export const getMeHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const { userId, email, fullName, organizationId, role } = req.auth;
  const [platformAdmin, canUseInternalAgent] = await Promise.all([
    findPlatformAdminByUserId(userId),
    role === "ADMIN"
      ? Promise.resolve(true)
      : findUserById(userId, organizationId).then((user) => user?.canUseInternalAgent === true),
  ]);
  res.status(200).json({
    id: userId,
    email,
    fullName,
    organizationId,
    role,
    isPlatformAdmin: platformAdmin !== null,
    canUseInternalAgent,
  });
});
