import { Router } from "express";
import {
  deleteUserHandler,
  listUsersHandler,
  updateUserHandler,
} from "../controllers/user.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const userRouter = Router();

// ADMIN-only en las tres: es administración del roster de la organización,
// no un módulo de negocio de lectura abierta como Company/Contact.
userRouter.get("/users", authenticate, authorize("ADMIN"), listUsersHandler);
userRouter.patch(
  "/users/:id",
  authenticate,
  authorize("ADMIN"),
  updateUserHandler,
);
userRouter.delete(
  "/users/:id",
  authenticate,
  authorize("ADMIN"),
  deleteUserHandler,
);
