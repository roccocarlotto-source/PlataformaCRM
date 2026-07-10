import { Router } from "express";
import {
  createStageHandler,
  deleteStageHandler,
  getStageHandler,
  listStagesHandler,
  updateStageHandler,
} from "../controllers/stage.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const stageRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
stageRouter.get("/stages", authenticate, listStagesHandler);
stageRouter.get("/stages/:id", authenticate, getStageHandler);

// Escritura: solo ADMIN.
stageRouter.post(
  "/stages",
  authenticate,
  authorize("ADMIN"),
  createStageHandler,
);
stageRouter.patch(
  "/stages/:id",
  authenticate,
  authorize("ADMIN"),
  updateStageHandler,
);
stageRouter.delete(
  "/stages/:id",
  authenticate,
  authorize("ADMIN"),
  deleteStageHandler,
);
