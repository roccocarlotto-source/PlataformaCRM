import type { Response } from "express";
import { z } from "zod";
import {
  createPayment,
  deletePayment,
  getPaymentById,
  listPaymentsByOpportunity,
  updatePayment,
} from "../services/payment.service";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { MAX_AMOUNT, parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.number() y NO z.coerce.number(), mismo motivo que Opportunity.amount
// (M-9): el body es JSON, y coerce convertiría un null en 0 sin avisar.
//
// El mínimo es 0.01 y no `.positive()`: Decimal(14, 2) redondea a dos
// decimales, así que un 0.004 pasaría un "> 0" de zod, llegaría a Postgres
// como 0.00 y el CHECK payments_amount_positive_check lo devolvería como 500.
// Con 0.01 el borde y la base dicen lo mismo.
const amountSchema = z
  .number({
    required_error: "amount es requerido",
    invalid_type_error: "amount debe ser un número",
  })
  .min(0.01, "amount debe ser mayor a 0")
  .max(MAX_AMOUNT, "amount supera el máximo permitido");

const methodSchema = z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "OTHER"], {
  errorMap: () => ({ message: "method debe ser CASH, TRANSFER, CARD, CHECK u OTHER" }),
});

// Fecha sola ("2026-09-30"), obligatoria. No z.coerce.date() a secas:
// coerce convierte null en 1970-01-01 y acepta un timestamp con hora, y
// new Date("2026-02-30") no falla sino que corre al 2 de marzo. Se exige el
// formato YYYY-MM-DD y que la fecha exista de verdad (ida y vuelta igual).
const paidAtSchema = z
  .string({
    required_error: "paidAt es requerido",
    invalid_type_error: "paidAt debe ser una fecha YYYY-MM-DD",
  })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "paidAt debe ser una fecha YYYY-MM-DD")
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "paidAt no es una fecha válida" });
      return z.NEVER;
    }
    return date;
  });

// Exportados para fijar con tests unitarios (sin base) qué rechaza el borde:
// ver payment.controller.test.ts.
//
// Sin currency, a propósito: es la FOTO de la moneda de la oportunidad y la
// pone el service (payment.service.ts). Sin paidAt opcional: la fecha de hoy
// la precarga el frontend, no un default escondido acá.
export const createPaymentSchema = z
  .object({
    opportunityId: z
      .string({ required_error: "opportunityId es requerido" })
      .uuid("opportunityId inválido"),
    amount: amountSchema,
    method: methodSchema,
    paidAt: paidAtSchema,
  })
  .strict("campo no permitido en el pago");

// opportunityId y currency NO son editables: .strict() los rechaza con 400 en
// vez de ignorarlos en silencio, para que nadie crea que movió un pago de
// oportunidad o le cambió la moneda.
export const updatePaymentSchema = z
  .object({
    amount: amountSchema,
    method: methodSchema,
    paidAt: paidAtSchema,
  })
  .partial()
  .strict("campo no permitido en el pago: solo se editan amount, method y paidAt")
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Obligatorio: el historial es de UNA oportunidad. No hay listado global de
  // pagos.
  opportunityId: z
    .string({ required_error: "opportunityId es requerido" })
    .uuid("opportunityId inválido"),
  // Tope de cordura, el mismo que el resto de los listados — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const listPaymentsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listPaymentsByOpportunity(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getPaymentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const payment = await getPaymentById(req.auth.organizationId, id);
  res.status(200).json(payment);
});

export const createPaymentHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createPaymentSchema, req.body);
    const payment = await createPayment(req.auth.organizationId, input);
    res.status(201).json(payment);
  },
);

export const updatePaymentHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
      throw new AppError("Debe enviar al menos un campo para actualizar", 400);
    }
    const input = parseOrThrow(updatePaymentSchema, req.body);
    const payment = await updatePayment(req.auth.organizationId, id, input);
    res.status(200).json(payment);
  },
);

export const deletePaymentHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deletePayment(req.auth.organizationId, id);
    res.status(204).send();
  },
);
