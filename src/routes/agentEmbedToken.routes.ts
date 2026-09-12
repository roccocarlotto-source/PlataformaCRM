import { Router } from "express";
import {
  createEmbedTokenHandler,
  listEmbedTokensHandler,
  revokeEmbedTokenHandler,
} from "../controllers/agentEmbedToken.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const agentEmbedTokenRouter = Router();

// Anidado bajo /agents/:id, a diferencia de /api-keys (plano con ?sourceId=):
// un token de embed no tiene existencia propia fuera de su agente —ni listado
// por organización, ni filtros—, así que la ruta dice de qué agente es.
//
// Las tres son ADMIN-only, INCLUIDA la lectura, igual que api-keys y a
// diferencia del CRUD de agentes (que cualquier autenticado lee): son
// credenciales, y aunque el listado no exponga el token, quién tiene tokens
// y cuándo se usaron es información de administración.
//
// El camino de autenticación es el EXISTENTE (authenticate + authorize).
// Ninguna de estas rutas acepta el token de embed: un token de embed sirve
// para que el widget escriba mensajes (5b), jamás para administrarse a sí
// mismo.
agentEmbedTokenRouter.get(
  "/agents/:id/embed-tokens",
  authenticate,
  authorize("ADMIN"),
  listEmbedTokensHandler,
);
agentEmbedTokenRouter.post(
  "/agents/:id/embed-tokens",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createEmbedTokenHandler,
);
// Revocación. No idempotente a propósito — ver agentEmbedToken.controller.ts.
agentEmbedTokenRouter.delete(
  "/agents/:id/embed-tokens/:tokenId",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  revokeEmbedTokenHandler,
);
