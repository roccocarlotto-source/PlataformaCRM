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
// /api/whatsapp-templates — la plantilla de WhatsApp de cada regla de
// automatización (ítem 160 de docs/frontend-cambios-pendientes.md; por regla
// desde el ítem 181: el POST y el GET piden automationId). Mismo
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

const automationIdSchema = z
  .string({ required_error: "automationId es requerido" })
  .uuid("automationId debe ser un UUID");

// GET: automationId es REQUERIDO. Sin él no hay "la" plantilla que devolver
// — una organización puede tener una por regla —, y devolver cualquiera de
// ellas es el error que el ítem 181 vino a sacar.
const getCurrentQuerySchema = z.object({ automationId: automationIdSchema });

const createWhatsappTemplateSchema = z.object({
  // Que exista, no esté borrada, sea de esta organización y mande WhatsApp lo
  // chequea el service (400 si no): acá solo la forma.
  automationId: automationIdSchema,
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

    // Un singleton por regla: devuelve la actual o `null`, siempre 200. "No
    // tiene" es un estado normal de la pantalla, no un 404 — tampoco para una
    // regla que no existe o es de otra organización: el filtro por
    // organizationId ya la deja sin plantilla, y no hay nada que revelar.
    getCurrent: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const { automationId } = parseOrThrow(getCurrentQuerySchema, req.query);
      const plantilla = await getCurrentWhatsappTemplate(req.auth.organizationId, automationId);
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
