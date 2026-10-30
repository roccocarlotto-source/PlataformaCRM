import type { Response } from "express";
import { z } from "zod";
import { estricto, mensajesDeTipo } from "../utils/erroresDeZod";
import {
  createQuote,
  getQuoteById,
  listQuotesByOpportunity,
  revertQuoteAcceptance,
  updateQuoteContent,
  updateQuoteStatus,
} from "../services/quote.service";
import { assertPuedeOperarLaOportunidad } from "../services/permisosEnLaOportunidad";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import {
  currencySchema,
  fechaSoloSchema,
  MAX_AMOUNT,
  parseOrThrow,
  tieneComoMuchoDosDecimales,
} from "../utils/validation";

const idParamSchema = z.string().guid("id inválido");

// Tope de cordura para las líneas: una cotización de una automotora lleva un
// puñado de accesorios y algún descuento, no un catálogo.
const MAX_LINES = 50;

// z.number() y NO z.coerce.number(), mismo motivo que Opportunity.amount
// (M-9): el body es JSON, y coerce convertiría un null en 0 sin avisar.
const amountSchema = z
  .number(mensajesDeTipo({ tipo: "amount debe ser un número" }))
  .min(0, "amount debe ser mayor o igual a 0")
  .max(MAX_AMOUNT, "amount supera el máximo permitido")
  .refine(tieneComoMuchoDosDecimales, "amount admite como mucho dos decimales");

// Una línea: texto libre + importe. Negativo es un descuento, positivo un
// accesorio o recargo. Sin catálogo ni impuestos, a propósito.
const lineSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "la descripción de cada línea es requerida")
    .max(200, "la descripción de una línea no puede superar los 200 caracteres"),
  amount: z
    .number(mensajesDeTipo({ tipo: "el monto de cada línea debe ser un número" }))
    .min(-MAX_AMOUNT, "el monto de una línea supera el máximo permitido")
    .max(MAX_AMOUNT, "el monto de una línea supera el máximo permitido")
    // Como mucho centavos: con más decimales, toFixed(2) sobre un float
    // redondearía distinto que el Decimal(14, 2) del monto principal.
    .refine(tieneComoMuchoDosDecimales, "el monto de una línea admite como mucho dos decimales"),
});

const linesSchema = z
  .array(lineSchema)
  .max(MAX_LINES, `una cotización no puede tener más de ${MAX_LINES} líneas`);

// Fecha sola ("2026-09-30"). .nullable() antes de coerce para que un null
// explícito limpie la fecha en vez de volverse 1970-01-01 — mismo bug que se
// corrigió en Opportunity.
const validUntilSchema = fechaSoloSchema("validUntil");

// Exportados para fijar con tests unitarios (sin base) qué rechaza el borde:
// ver quote.controller.test.ts.
export const createQuoteSchema = z.object({
  opportunityId: z.string().guid("opportunityId inválido"),
  amount: amountSchema,
  currency: currencySchema,
  lines: linesSchema.default([]),
  validUntil: validUntilSchema.optional(),
});

// PATCH /quotes/:id tiene TRES formas, y no se mezclan:
//
//   1. { status }: una transición (Enviar, Marcar aceptada, Marcar
//      rechazada). Solo los tres destinos a los que se llega a mano.
//   2. { amount?, currency?, lines?, validUntil? }: editar el contenido de un
//      borrador.
//   3. { revertAcceptance: true }: volver una aceptada a enviada (PR-17),
//      solo ADMIN. Es una forma aparte y no { status: "SENT" } sobre una
//      aceptada: un "Enviar" viejo sobre un borrador que otro ya mandó y
//      aceptó no puede deshacer la aceptación por accidente.
//
// El ítem pedía "PATCH solo status", pero también "una DRAFT se edita
// libremente" — y sin esta segunda forma no habría con qué. Juntar status y
// contenido en un body es 400: no hay un orden obvio (¿editar y después
// enviar, o enviar y fallar al editar?), mismo criterio que confirmed +
// completedAt en Activity (§29).
export const updateQuoteStatusSchema = z
  .object({
    status: z.enum(["SENT", "ACCEPTED", "REJECTED"], {
      error: () => "status debe ser SENT, ACCEPTED o REJECTED",
    }),
  })
  .apply(estricto("status no se combina con otros campos en el mismo PATCH"));

export const revertQuoteAcceptanceSchema = z
  .object({
    revertAcceptance: z.literal(true, { error: () => "revertAcceptance debe ser true" }),
  })
  .apply(estricto("revertAcceptance no se combina con otros campos en el mismo PATCH"));

export const MENSAJE_SOLO_ADMIN_REVIERTE =
  "Solo un administrador puede revertir la aceptación de una cotización";

export const updateQuoteContentSchema = z
  .object({
    amount: amountSchema,
    currency: currencySchema,
    lines: linesSchema,
    validUntil: validUntilSchema,
  })
  .partial()
  .apply(estricto("campo no permitido en la cotización"))
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Obligatorio: el historial es de UNA oportunidad. No hay listado global de
  // cotizaciones.
  opportunityId: z
    .string(mensajesDeTipo({ requerido: "opportunityId es requerido" }))
    .guid("opportunityId inválido"),
  // Tope de cordura, el mismo que el resto de los listados — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const listQuotesHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  const result = await listQuotesByOpportunity(req.auth.organizationId, query);
  res.status(200).json(result);
});

export const getQuoteHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const quote = await getQuoteById(req.auth.organizationId, id);
  res.status(200).json(quote);
});

export const createQuoteHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const input = parseOrThrow(createQuoteSchema, req.body);
  // PR-17: un USER cotiza solo en las oportunidades que tiene asignadas.
  await assertPuedeOperarLaOportunidad(req.auth, req.auth.organizationId, input.opportunityId);
  const quote = await createQuote(req.auth.organizationId, req.auth.userId, input);
  res.status(201).json(quote);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const updateQuoteHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  if (!isObject(req.body)) {
    throw new AppError("Debe enviar al menos un campo para actualizar", 400);
  }

  // Revertir es de ADMIN, sin importar de quién sea la oportunidad.
  if ("revertAcceptance" in req.body) {
    parseOrThrow(revertQuoteAcceptanceSchema, req.body);
    if (req.auth.role !== "ADMIN") {
      throw new AppError(MENSAJE_SOLO_ADMIN_REVIERTE, 403);
    }
    const quote = await revertQuoteAcceptance(req.auth.organizationId, id);
    res.status(200).json(quote);
    return;
  }

  // PR-17: un USER edita, envía, acepta y rechaza solo las cotizaciones de
  // las oportunidades que tiene asignadas.
  if (req.auth.role !== "ADMIN") {
    const actual = await getQuoteById(req.auth.organizationId, id);
    await assertPuedeOperarLaOportunidad(req.auth, req.auth.organizationId, actual.opportunityId);
  }

  // La presencia de `status` decide la forma; cada schema es .strict(), así
  // que mezclar las dos cae en el 400 de la que corresponda.
  if ("status" in req.body) {
    const { status } = parseOrThrow(updateQuoteStatusSchema, req.body);
    const quote = await updateQuoteStatus(req.auth.organizationId, id, status);
    res.status(200).json(quote);
    return;
  }

  const input = parseOrThrow(updateQuoteContentSchema, req.body);
  const quote = await updateQuoteContent(req.auth.organizationId, id, input);
  res.status(200).json(quote);
});
