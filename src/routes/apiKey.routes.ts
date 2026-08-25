import { Router } from "express";
import {
  createApiKeyHandler,
  listApiKeysHandler,
  revokeApiKeyHandler,
} from "../controllers/apiKey.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const apiKeyRouter = Router();

// Ruta plana `/api/api-keys`, no anidada bajo /sources/:sourceId: no hay
// anidamiento en ningún router del proyecto (stages se filtra por pipelineId
// como query param, no por path), y el filtro ?sourceId= cubre el mismo caso.
//
// El camino de autenticación es el EXISTENTE: authenticate + authorize.
// Ninguna de estas rutas monta authenticateApiKey — una API key sirve para
// ingestar, jamás para administrarse a sí misma. Eso es el ítem 4 y es un
// camino aparte, no una modificación de este.
apiKeyRouter.get(
  "/api-keys",
  authenticate,
  authorize("ADMIN"),
  listApiKeysHandler,
);
apiKeyRouter.post(
  "/api-keys",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createApiKeyHandler,
);
// Revocación. No idempotente a propósito — ver apiKey.controller.ts.
apiKeyRouter.delete(
  "/api-keys/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  revokeApiKeyHandler,
);
