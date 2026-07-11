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

export const activityRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
activityRouter.get("/activities", authenticate, listActivitiesHandler);
activityRouter.get("/activities/:id", authenticate, getActivityHandler);

// Escritura: solo ADMIN.
activityRouter.post(
  "/activities",
  authenticate,
  authorize("ADMIN"),
  createActivityHandler,
);
activityRouter.patch(
  "/activities/:id",
  authenticate,
  authorize("ADMIN"),
  updateActivityHandler,
);
activityRouter.delete(
  "/activities/:id",
  authenticate,
  authorize("ADMIN"),
  deleteActivityHandler,
);
