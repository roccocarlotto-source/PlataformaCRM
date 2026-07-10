import { Router } from "express";
import {
  createContactHandler,
  deleteContactHandler,
  getContactHandler,
  listContactsHandler,
  updateContactHandler,
} from "../controllers/contact.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const contactRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
contactRouter.get("/contacts", authenticate, listContactsHandler);
contactRouter.get("/contacts/:id", authenticate, getContactHandler);

// Escritura: solo ADMIN.
contactRouter.post(
  "/contacts",
  authenticate,
  authorize("ADMIN"),
  createContactHandler,
);
contactRouter.patch(
  "/contacts/:id",
  authenticate,
  authorize("ADMIN"),
  updateContactHandler,
);
contactRouter.delete(
  "/contacts/:id",
  authenticate,
  authorize("ADMIN"),
  deleteContactHandler,
);
