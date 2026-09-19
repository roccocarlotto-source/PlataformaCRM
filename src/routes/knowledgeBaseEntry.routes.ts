import { Router } from "express";
import {
  createKnowledgeBaseEntryHandler,
  deleteKnowledgeBaseEntryHandler,
  getKnowledgeBaseEntryHandler,
  listKnowledgeBaseEntriesHandler,
  updateKnowledgeBaseEntryHandler,
} from "../controllers/knowledgeBaseEntry.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const knowledgeBaseEntryRouter = Router();

// Mismo esquema de permisos que agent.routes.ts y branch.routes.ts: lectura
// para cualquier usuario autenticado de la organización, escritura solo ADMIN.
// No se inventó nada nuevo — Role sigue teniendo ADMIN/USER y nada más.
knowledgeBaseEntryRouter.get("/knowledge-base", authenticate, listKnowledgeBaseEntriesHandler);
knowledgeBaseEntryRouter.get("/knowledge-base/:id", authenticate, getKnowledgeBaseEntryHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que agent.routes.ts.
knowledgeBaseEntryRouter.post(
  "/knowledge-base",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createKnowledgeBaseEntryHandler,
);
knowledgeBaseEntryRouter.patch(
  "/knowledge-base/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateKnowledgeBaseEntryHandler,
);
knowledgeBaseEntryRouter.delete(
  "/knowledge-base/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteKnowledgeBaseEntryHandler,
);
