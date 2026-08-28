import { Router } from "express";
import {
  createContactHandler,
  deleteContactHandler,
  erasePersonalDataHandler,
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

// Borrado de datos personales a pedido (D2-4). ADMIN-only y con el mismo
// rate limiter de escritura que el resto: es la operación más destructiva del
// módulo, no una excepción a la que se le aflojan los controles.
//
// Ruta propia y no un flag de DELETE /contacts/:id: son dos operaciones
// distintas —una reversible, la otra no— y compartir endpoint haría que la
// diferencia dependiera de un parámetro que se puede olvidar.
contactRouter.post(
  "/contacts/:id/erase-personal-data",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  erasePersonalDataHandler,
);
