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
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const stageRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
stageRouter.get("/stages", authenticate, listStagesHandler);
stageRouter.get("/stages/:id", authenticate, getStageHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
stageRouter.post(
  "/stages",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createStageHandler,
);
stageRouter.patch(
  "/stages/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateStageHandler,
);
stageRouter.delete(
  "/stages/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteStageHandler,
);
