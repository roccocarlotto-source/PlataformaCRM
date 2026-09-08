import type { Response } from "express";
import { findPlatformAdminByUserId } from "../repositories/platformAdmin.repository";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";

// Serializa req.auth (ya resuelto por el middleware authenticate contra
// Postgres, ver src/services/auth.service.ts) al contrato HTTP de
// GET /api/me. No valida input (el endpoint no recibe ninguno).
//
// isPlatformAdmin (Fase 4a del módulo SaaS) es la ÚNICA consulta propia de
// este controller, y va acá y no en AuthContext a propósito: resolverla en
// `authenticate` la cobraría en cada request de la API, cuando el único que
// la necesita es el frontend, una vez por sesión, para mostrar u ocultar la
// herramienta de platform admin. Es la misma consulta que requirePlatformAdmin
// (platformAdmin.repository.ts) — la autorización real sigue siendo ese
// middleware en cada llamada, nunca este booleano.
export const getMeHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const { userId, email, fullName, organizationId, role } = req.auth;
  const isPlatformAdmin = (await findPlatformAdminByUserId(userId)) !== null;
  res.status(200).json({ id: userId, email, fullName, organizationId, role, isPlatformAdmin });
});
