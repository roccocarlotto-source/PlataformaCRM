import type { Response } from "express";
import { z } from "zod";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunityById,
  listOpportunities,
  updateOpportunity,
} from "../services/opportunity.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const statusSchema = z.enum(["OPEN", "WON", "LOST"]);

// No hay enum de moneda en el schema (currency es VarChar(3) libre, a
// propósito: ISO 4217 tiene ~180 códigos, no es un conjunto chico de
// estados de negocio como sí lo son LifecycleStage/OpportunityStatus) — se
// valida el formato, no una lista cerrada.
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "currency debe ser un código ISO 4217 de 3 letras");

const opportunityFields = {
  title: z
    .string()
    .trim()
    .min(1, "title es requerido")
    .max(255, "title no puede superar los 255 caracteres"),
  // z.number() y NO z.coerce.number() — M-9 de docs/auditoria-2026-08-29.md.
  // `amount` viene de un body JSON, donde un cliente bien hecho manda un
  // número; coerce solo tiene sentido en query strings, que Express entrega
  // siempre como string. Con coerce, `Number(null)` es 0, así que
  // `{"amount": null}` —la forma natural de pedir "limpiá el monto"— pasaba el
  // .min(0) y se guardaba como 0 sin que nadie lo pidiera; lo mismo con "",
  // [] y false. Ahora un null explícito es un 400. Si en algún momento se
  // decide que `amount` se pueda limpiar con null en PATCH, eso es .nullable()
  // y es la conversación de M-10, no ésta.
  amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
  currency: currencySchema.optional(),
  status: statusSchema.optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
  contactId: z.string().uuid("contactId inválido").optional(),
  pipelineId: z.string().uuid("pipelineId inválido"),
  stageId: z.string().uuid("stageId inválido"),
  ownerId: z.string().uuid("ownerId inválido").optional(),
};

// Exportado para poder fijar con tests unitarios (sin base) qué rechaza el
// borde: ver opportunity.controller.test.ts.
export const createOpportunitySchema = z
  .object({
    ...opportunityFields,
    expectedCloseDate: z.coerce.date().optional(),
    actualCloseDate: z.coerce.date().optional(),
    lostReason: z
      .string()
      .trim()
      .max(255, "lostReason no puede superar los 255 caracteres")
      .optional(),
  })
  .refine((data) => Boolean(data.companyId) || Boolean(data.contactId), {
    message: "Debe indicar companyId, contactId, o ambos",
  });

// expectedCloseDate/actualCloseDate/lostReason son .nullable() acá (a
// diferencia de create): permite limpiarlos explícitamente — necesario para
// reabrir una oportunidad WON/LOST de vuelta a OPEN sin arrastrar datos de un
// cierre anterior. Sin .nullable(), z.coerce.date() convertía un `null`
// explícito en 1970-01-01 en vez de rechazarlo o limpiarlo.
export const updateOpportunitySchema = z
  .object({
    ...opportunityFields,
    expectedCloseDate: z.coerce.date().nullable().optional(),
    actualCloseDate: z.coerce.date().nullable().optional(),
    lostReason: z
      .string()
      .trim()
      .max(255, "lostReason no puede superar los 255 caracteres")
      .nullable()
      .optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
  contactId: z.string().uuid("contactId inválido").optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
  pipelineId: z.string().uuid("pipelineId inválido").optional(),
  stageId: z.string().uuid("stageId inválido").optional(),
  status: statusSchema.optional(),
  currency: currencySchema.optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "amount", "title"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createOpportunityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createOpportunitySchema, req.body);
    const opportunity = await createOpportunity(req.auth.organizationId, req.auth.userId, input);
    res.status(201).json(opportunity);
  },
);

export const listOpportunitiesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listOpportunities(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getOpportunityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const opportunity = await getOpportunityById(req.auth.organizationId, id);
    res.status(200).json(opportunity);
  },
);

export const updateOpportunityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateOpportunitySchema, req.body);
    const opportunity = await updateOpportunity(
      req.auth.organizationId,
      req.auth.userId,
      id,
      input,
    );
    res.status(200).json(opportunity);
  },
);

export const deleteOpportunityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteOpportunity(req.auth.organizationId, id);
    res.status(204).send();
  },
);
