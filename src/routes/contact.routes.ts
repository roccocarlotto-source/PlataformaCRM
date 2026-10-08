import { Router } from "express";
import {
  createContactHandler,
  deleteContactHandler,
  descartarConsultaHandler,
  erasePersonalDataHandler,
  getContactHandler,
  listContactsHandler,
  mergeContactHandler,
  mergePreviewHandler,
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
  // Sin authorize("ADMIN") desde D2 (OPUS-I-03, docs-privados, local): un USER
  // crea, y lo creado queda a su nombre. Ver services/permisosDelVendedor.ts.
  createContactHandler,
);
contactRouter.patch(
  "/contacts/:id",
  authenticate,
  businessWriteRateLimiter,
  // Sin authorize("ADMIN") desde D2: un USER edita lo que tiene asignado; el
  // chequeo de dueño está en el controller (permisosDelVendedor.ts). Borrar
  // sigue siendo de ADMIN, más abajo.
  updateContactHandler,
);
contactRouter.delete(
  "/contacts/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteContactHandler,
);

// Descartar una consulta sin identificar (ítem 184): la baja de DELETE, pero
// cerrando antes sus conversaciones abiertas. Mismos controles que DELETE.
contactRouter.post(
  "/contacts/:id/descartar",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  descartarConsultaHandler,
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

// Unir contactos duplicados (contactMerge.service.ts). ADMIN-only, también la
// vista previa: muestra los datos de los dos y cuánto se mueve, y solo tiene
// sentido para quien puede unir.
contactRouter.get(
  "/contacts/:id/merge-preview",
  authenticate,
  authorize("ADMIN"),
  mergePreviewHandler,
);
contactRouter.post(
  "/contacts/:id/merge",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  mergeContactHandler,
);
