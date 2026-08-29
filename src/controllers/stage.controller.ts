import type { Response } from "express";
import { z } from "zod";
import {
  createStage,
  deleteStage,
  getStageById,
  listStages,
  updateStage,
} from "../services/stage.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const notBothWonAndLost = (data: { isWon?: boolean; isLost?: boolean }) =>
  !(data.isWon && data.isLost);

// z.number() y NO z.coerce.number() en `order` y `probability` — M-9 de
// docs/auditoria-2026-08-29.md. Vienen de un body JSON, donde un cliente bien
// hecho manda un número; coerce es para query strings, que Express entrega
// siempre como string. Con coerce, `Number(null)` es 0: en `order` lo frenaba
// el .positive() por casualidad, pero `{"probability": null}` pasaba el
// .min(0) y se guardaba como 0 sin que nadie lo pidiera. Ahora un null
// explícito es un 400 en los dos; "limpiar con null" sería .nullable() y es la
// conversación de M-10, no ésta.
//
// Exportados para poder fijar con tests unitarios (sin base) qué rechaza el
// borde: ver stage.controller.test.ts.
export const createStageSchema = z
  .object({
    pipelineId: z.string().uuid("pipelineId inválido"),
    name: z
      .string()
      .trim()
      .min(1, "name es requerido")
      .max(100, "name no puede superar los 100 caracteres"),
    order: z.number().int().positive().optional(),
    probability: z
      .number()
      .min(0, "probability debe estar entre 0 y 100")
      .max(100, "probability debe estar entre 0 y 100")
      .optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
  })
  .refine(notBothWonAndLost, {
    message: "Una etapa no puede estar ganada y perdida a la vez",
  });

// pipelineId no es editable — una etapa no cambia de pipeline una vez creada.
export const updateStageSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name es requerido")
      .max(100, "name no puede superar los 100 caracteres"),
    order: z.number().int().positive(),
    probability: z.number().min(0).max(100),
    isWon: z.boolean(),
    isLost: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  })
  .refine(notBothWonAndLost, {
    message: "Una etapa no puede estar ganada y perdida a la vez",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  pipelineId: z.string().uuid("pipelineId inválido").optional(),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(["order", "name", "createdAt"]).default("order"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const createStageHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const input = parseOrThrow(createStageSchema, req.body);
  const stage = await createStage(req.auth.organizationId, input);
  res.status(201).json(stage);
});

export const listStagesHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  const result = await listStages(req.auth.organizationId, query);
  res.status(200).json(result);
});

export const getStageHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const stage = await getStageById(req.auth.organizationId, id);
  res.status(200).json(stage);
});

export const updateStageHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const input = parseOrThrow(updateStageSchema, req.body);
  const stage = await updateStage(req.auth.organizationId, id, input);
  res.status(200).json(stage);
});

export const deleteStageHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await deleteStage(req.auth.organizationId, id);
  res.status(204).send();
});
