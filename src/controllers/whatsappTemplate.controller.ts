import type { Response } from "express";
import { z } from "zod";
import {
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  depsDePlantillasReales,
  getCurrentWhatsappTemplate,
  refreshWhatsappTemplate,
  type DepsDePlantillas,
} from "../services/whatsappTemplate.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import {
  PATRON_IDIOMA_DE_PLANTILLA,
  PATRON_NOMBRE_DE_PLANTILLA,
} from "../utils/whatsappTemplateText";

// ---------------------------------------------------------------------------
// /api/whatsapp-templates — la plantilla de seguimiento post-venta de la
// organización (ítem 160 de docs/frontend-cambios-pendientes.md). Mismo
// reparto que automation.controller.ts: acá se valida la FORMA del cuerpo; el
// contenido del texto ({nombre}/{link}, su orden, dónde no pueden ir) lo
// decide el service con utils/whatsappTemplateText.ts, porque es la regla de
// negocio y tiene sus propios tests.
//
// Los handlers salen de una factory que recibe las llamadas a Meta, igual que
// el webhook: producción usa las reales y el test de integración ejercita la
// MISMA cadena (authenticate, authorize, rate limiter) con un doble.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const createWhatsappTemplateSchema = z.object({
  name: z
    .string({ required_error: "name es requerido" })
    .trim()
    .min(1, "name es requerido")
    .max(512, "name no puede superar los 512 caracteres")
    .regex(
      PATRON_NOMBRE_DE_PLANTILLA,
      "El nombre solo puede tener minúsculas, números y guion bajo (ej. seguimiento_postventa)",
    ),
  language: z
    .string({ required_error: "language es requerido" })
    .trim()
    .regex(PATRON_IDIOMA_DE_PLANTILLA, "language debe ser un código de idioma de Meta (ej. es_AR)"),
  // Solo la forma y un tope de cordura: el tope real (1024, medido sobre el
  // texto que viaja a Meta) lo aplica el service.
  bodyText: z
    .string({ required_error: "bodyText es requerido" })
    .max(4000, "El texto es demasiado largo"),
});

export function createWhatsappTemplateHandlers(deps: DepsDePlantillas = depsDePlantillasReales) {
  return {
    create: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const input = parseOrThrow(createWhatsappTemplateSchema, req.body);
      const plantilla = await createWhatsappTemplate(req.auth.organizationId, input, deps);
      res.status(201).json(plantilla);
    }),

    // Un singleton por organización: devuelve la actual o `null`, siempre 200.
    // "No tiene" es un estado normal de la pantalla, no un 404.
    getCurrent: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const plantilla = await getCurrentWhatsappTemplate(req.auth.organizationId);
      res.status(200).json(plantilla);
    }),

    remove: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const id = parseOrThrow(idParamSchema, req.params.id);
      await deleteWhatsappTemplate(req.auth.organizationId, id, deps);
      res.status(204).send();
    }),

    refresh: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const id = parseOrThrow(idParamSchema, req.params.id);
      const plantilla = await refreshWhatsappTemplate(req.auth.organizationId, id, deps);
      res.status(200).json(plantilla);
    }),
  };
}
