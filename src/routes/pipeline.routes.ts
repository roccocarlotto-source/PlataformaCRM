import { Router } from "express";
import {
  createPipelineHandler,
  deletePipelineHandler,
  getPipelineHandler,
  listPipelinesHandler,
  updatePipelineHandler,
} from "../controllers/pipeline.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const pipelineRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
pipelineRouter.get("/pipelines", authenticate, listPipelinesHandler);
pipelineRouter.get("/pipelines/:id", authenticate, getPipelineHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
pipelineRouter.post(
  "/pipelines",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createPipelineHandler,
);
pipelineRouter.patch(
  "/pipelines/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updatePipelineHandler,
);
pipelineRouter.delete(
  "/pipelines/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deletePipelineHandler,
);
