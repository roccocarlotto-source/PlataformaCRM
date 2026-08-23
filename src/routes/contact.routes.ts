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
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const contactRouter = Router();

// Lectura: cualquier usuario autenticado de la organización.
contactRouter.get("/contacts", authenticate, listContactsHandler);
contactRouter.get("/contacts/:id", authenticate, getContactHandler);

// Escritura: solo ADMIN. businessWriteRateLimiter (R1.9) va después de
// authenticate (necesita req.auth.userId) y antes de authorize — ver
// rateLimit.ts.
contactRouter.post(
  "/contacts",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createContactHandler,
);
contactRouter.patch(
  "/contacts/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateContactHandler,
);
contactRouter.delete(
  "/contacts/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteContactHandler,
);
