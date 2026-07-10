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

export const pipelineRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
pipelineRouter.get("/pipelines", authenticate, listPipelinesHandler);
pipelineRouter.get("/pipelines/:id", authenticate, getPipelineHandler);

// Escritura: solo ADMIN.
pipelineRouter.post(
  "/pipelines",
  authenticate,
  authorize("ADMIN"),
  createPipelineHandler,
);
pipelineRouter.patch(
  "/pipelines/:id",
  authenticate,
  authorize("ADMIN"),
  updatePipelineHandler,
);
pipelineRouter.delete(
  "/pipelines/:id",
  authenticate,
  authorize("ADMIN"),
  deletePipelineHandler,
);
