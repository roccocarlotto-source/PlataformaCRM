import { Router } from "express";
import {
  deleteUserHandler,
  listUsersHandler,
  updateUserHandler,
} from "../controllers/user.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const userRouter = Router();

// ADMIN-only en las tres: es administración del roster de la organización,
// no un módulo de negocio de lectura abierta como Company/Contact.
// businessWriteRateLimiter (R1.9) solo en las escrituras (PATCH/DELETE),
// mismo criterio que el resto de los routers — GET no es una escritura.
userRouter.get("/users", authenticate, authorize("ADMIN"), listUsersHandler);
userRouter.patch(
  "/users/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateUserHandler,
);
userRouter.delete(
  "/users/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteUserHandler,
);
