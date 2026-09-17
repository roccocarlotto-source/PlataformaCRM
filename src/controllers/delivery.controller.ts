import type { Response } from "express";
import { z } from "zod";
import {
  confirmDelivery,
  getDeliveryById,
  listDeliveriesByOpportunity,
  updateDelivery,
} from "../services/delivery.service";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// Tope de cordura: el default trae cinco ítems y cada entrega suma los suyos
// (una patente provisoria, un accesorio), no un inventario.
const MAX_CHECKLIST_ITEMS = 50;

const checklistItemSchema = z
  .object({
    label: z
      .string({ invalid_type_error: "el texto de cada ítem debe ser un texto" })
      .trim()
      .min(1, "el texto de cada ítem del checklist es requerido")
      .max(200, "el texto de un ítem del checklist no puede superar los 200 caracteres"),
    checked: z.boolean({
      required_error: "cada ítem del checklist necesita checked",
      invalid_type_error: "checked debe ser true o false",
    }),
  })
  .strict("campo no permitido en un ítem del checklist");

const checklistSchema = z
  .array(checklistItemSchema)
  .max(MAX_CHECKLIST_ITEMS, `el checklist no puede tener más de ${MAX_CHECKLIST_ITEMS} ítems`);

// Fecha sola ("2026-09-30"). .nullable() antes de coerce para que un null
// explícito limpie la fecha en vez de volverse 1970-01-01 — mismo bug que se
// corrigió en Opportunity, mismo schema que Quote.validUntil.
const scheduledAtSchema = z.coerce.date({ invalid_type_error: "scheduledAt inválida" }).nullable();

// PATCH /deliveries/:id tiene DOS formas, y no se mezclan (mismo criterio que
// PATCH /quotes/:id):
//
//   1. { status: "DELIVERED" }: "Confirmar entrega". El único destino: a
//      PENDING no se vuelve.
//   2. { checklist?, scheduledAt? }: editar una entrega PENDING.
//
// Juntar status con otro campo es 400: ¿se guarda el checklist y después se
// confirma, o se confirma y falla al editar? No hay orden obvio.
//
// Exportados para fijar con tests unitarios (sin base) qué rechaza el borde:
// ver delivery.controller.test.ts.
export const confirmDeliverySchema = z
  .object({
    status: z.literal("DELIVERED", {
      errorMap: () => ({ message: "status debe ser DELIVERED" }),
    }),
  })
  .strict("status no se combina con otros campos en el mismo PATCH");

export const updateDeliverySchema = z
  .object({
    checklist: checklistSchema,
    scheduledAt: scheduledAtSchema,
  })
  .partial()
  .strict("campo no permitido en la entrega")
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const listDeliveriesQuerySchema = z.object({
  // Obligatorio: la entrega es de UNA oportunidad. No hay listado global.
  opportunityId: z
    .string({ required_error: "opportunityId es requerido" })
    .uuid("opportunityId inválido"),
});

export const listDeliveriesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { opportunityId } = parseOrThrow(listDeliveriesQuerySchema, req.query);
    const result = await listDeliveriesByOpportunity(req.auth.organizationId, opportunityId);
    res.status(200).json(result);
  },
);

export const getDeliveryHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const delivery = await getDeliveryById(req.auth.organizationId, id);
  res.status(200).json(delivery);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const updateDeliveryHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    if (!isObject(req.body)) {
      throw new AppError("Debe enviar al menos un campo para actualizar", 400);
    }

    // La presencia de `status` decide la forma; cada schema es .strict(), así
    // que mezclar las dos cae en el 400 de la que corresponda.
    if ("status" in req.body) {
      parseOrThrow(confirmDeliverySchema, req.body);
      const delivery = await confirmDelivery(req.auth.organizationId, req.auth.userId, id);
      res.status(200).json(delivery);
      return;
    }

    const input = parseOrThrow(updateDeliverySchema, req.body);
    const delivery = await updateDelivery(req.auth.organizationId, id, input);
    res.status(200).json(delivery);
  },
);
