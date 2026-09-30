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

// Lectura: cualquier usuario autenticado de la organización llega al handler,
// pero NO ve todo — desde el §25 (docs/frontend-cambios-pendientes.md) un
// USER recibe solo las actividades asignadas a sí mismo, y una ajena por id
// es 404. Esa restricción vive en el service (listActivities/getActivityById
// reciben el actor) y no como authorize("ADMIN") acá, porque "Mis tareas"
// (para ambos roles) usa estos mismos dos endpoints para lo propio.
activityRouter.get("/activities", authenticate, listActivitiesHandler);
activityRouter.get("/activities/:id", authenticate, getActivityHandler);

// Escritura. businessWriteRateLimiter (R1.9) va después de authenticate
// (necesita req.auth.userId) y antes de authorize — ver rateLimit.ts.
//
// POST sin authorize("ADMIN") desde B-18 (docs-privados/auditoria-2026-09-30-corta.md,
// local, no está en GitHub): el vendedor también crea tareas, como ya podía
// hacerlo por create_internal_task. La regla es de rol pero depende del
// body (a quién se asigna), así que vive en el service
// (resolveAssigneeForActor): un USER solo crea actividades asignadas a sí
// mismo — sin assignee, queda él; con otro, 403.
activityRouter.post("/activities", authenticate, businessWriteRateLimiter, createActivityHandler);
// PATCH tampoco lleva authorize("ADMIN"), y no es un olvido: su
// autorización es a nivel de RECURSO, no de rol, así que vive en el service
// (canUserPatchActivity, activity.service.ts), que es el único lugar que
// tiene la actividad real a mano. La regla: ADMIN edita cualquier campo de
// cualquier actividad, como siempre; un USER solo toca una actividad
// asignada a sí mismo y todavía no completada (§29: no puede destildarse;
// deshacer un tilde es "Rechazar", que solo hace un ADMIN). Sobre esas,
// completa cualquiera (solo completedAt, el tilde de "Mis tareas") y edita
// el resto de los campos solo de las que creó él (B-18), sin reasignarlas
// a otro. Cualquier otra combinación —incluido `confirmed`, la acción
// Confirmar/Rechazar— recibe el mismo 403 que daría authorize. DELETE sigue
// siendo ADMIN-only.
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
