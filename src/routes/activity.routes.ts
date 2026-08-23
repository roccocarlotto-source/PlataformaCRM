import { Router } from "express";
import {
  createActivityHandler,
  deleteActivityHandler,
  getActivityHandler,
  listActivitiesHandler,
  updateActivityHandler,
} from "../controllers/activity.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const activityRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
activityRouter.get("/activities", authenticate, listActivitiesHandler);
activityRouter.get("/activities/:id", authenticate, getActivityHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
activityRouter.post(
  "/activities",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createActivityHandler,
);
activityRouter.patch(
  "/activities/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateActivityHandler,
);
activityRouter.delete(
  "/activities/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteActivityHandler,
);
