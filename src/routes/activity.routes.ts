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
// PATCH es la única escritura SIN authorize("ADMIN") en la ruta, y no es
// un olvido: su autorización es a nivel de RECURSO, no de rol, así que
// vive en el service (canSelfServiceCompleteActivity, activity.service.ts),
// que es el único lugar que tiene la actividad real a mano. La regla:
// ADMIN edita cualquier campo de cualquier actividad, como siempre; un
// USER puede PATCHear una actividad si y solo si es su propio assignee Y
// el único campo del body es completedAt (tildar/destildar "Mis tareas").
// Cualquier otra combinación recibe el mismo 403 que daría authorize.
// POST y DELETE siguen siendo ADMIN-only, sin cambios.
activityRouter.patch(
  "/activities/:id",
  authenticate,
  businessWriteRateLimiter,
  updateActivityHandler,
);
activityRouter.delete(
  "/activities/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteActivityHandler,
);
