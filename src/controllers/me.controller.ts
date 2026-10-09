import { findInternalAgentByOrganization } from "../repositories/internalAgent.repository";
import type { Response } from "express";
import { MODULOS, modulosDe } from "../config/ediciones";
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
  const { userId, email, fullName, organizationId, role, edition, industry } = req.auth;
  // internalAgentConfigured (OPUS-F-04 / FABLE-F-07, docs-privados, local): si
  // la organización TIENE un agente interno. Sin este dato la pantalla del
  // agente interno pedía su configuración y sus mensajes para enterarse de que
  // no existía, y cada visita dejaba dos 404 en la consola. En la misma ida
  // que las otras dos lecturas.
  const [platformAdmin, canUseInternalAgent, agenteInterno] = await Promise.all([
    findPlatformAdminByUserId(userId),
    role === "ADMIN"
      ? Promise.resolve(true)
      : findUserById(userId, organizationId).then((user) => user?.canUseInternalAgent === true),
    findInternalAgentByOrganization(organizationId),
  ]);
  res.status(200).json({
    id: userId,
    email,
    fullName,
    organizationId,
    role,
    isPlatformAdmin: platformAdmin !== null,
    canUseInternalAgent,
    internalAgentConfigured: agenteInterno !== null,
    // Ediciones (docs/ediciones.md §7): la edición y los módulos que incluye,
    // calculados acá desde src/config/ediciones.ts para que el frontend no
    // tenga una tabla propia. En el orden del catálogo. Es solo para mostrar
    // u ocultar: lo que decide es el gate de cada request. Con el rubro
    // (docs/rubros.md §1.2), los módulos son los de la edición Y los del rubro.
    edition,
    industry,
    modulos: MODULOS.filter((modulo) => modulosDe(edition, industry).has(modulo)),
  });
});
