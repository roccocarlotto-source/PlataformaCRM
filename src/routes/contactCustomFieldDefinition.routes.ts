import { Router } from "express";
import {
  createContactCustomFieldDefinitionHandler,
  deleteContactCustomFieldDefinitionHandler,
  getContactCustomFieldDefinitionHandler,
  getContactCustomFieldOptionUsageHandler,
  listContactCustomFieldDefinitionsHandler,
  updateContactCustomFieldDefinitionHandler,
} from "../controllers/contactCustomFieldDefinition.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const contactCustomFieldDefinitionRouter = Router();

// ---------------------------------------------------------------------------
// Campos personalizados de contactos, v1 (B6). Mismo criterio que los otros
// catálogos (service-types): leer puede cualquiera autenticado —la ficha del
// contacto los muestra a todos—; definirlos, editarlos y borrarlos, ADMIN.
// El orden de los middlewares de escritura es el de siempre: el rate limiter
// necesita req.auth.userId, así que va después de authenticate.
// ---------------------------------------------------------------------------

contactCustomFieldDefinitionRouter.get(
  "/contact-custom-fields",
  authenticate,
  listContactCustomFieldDefinitionsHandler,
);
contactCustomFieldDefinitionRouter.get(
  "/contact-custom-fields/:id",
  authenticate,
  getContactCustomFieldDefinitionHandler,
);
// Cuántos contactos usan cada opción: lo consulta el formulario antes de
// guardar un cambio de opciones. ADMIN, como las escrituras a las que sirve.
contactCustomFieldDefinitionRouter.get(
  "/contact-custom-fields/:id/option-usage",
  authenticate,
  authorize("ADMIN"),
  getContactCustomFieldOptionUsageHandler,
);
contactCustomFieldDefinitionRouter.post(
  "/contact-custom-fields",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createContactCustomFieldDefinitionHandler,
);
contactCustomFieldDefinitionRouter.patch(
  "/contact-custom-fields/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateContactCustomFieldDefinitionHandler,
);
contactCustomFieldDefinitionRouter.delete(
  "/contact-custom-fields/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteContactCustomFieldDefinitionHandler,
);
