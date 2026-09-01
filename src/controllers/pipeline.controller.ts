import type { Response } from "express";
import { z } from "zod";
import {
  createPipeline,
  deletePipeline,
  getPipelineById,
  listPipelines,
  updatePipeline,
} from "../services/pipeline.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const pipelineFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(100, "name no puede superar los 100 caracteres"),
  isDefault: z.boolean().optional(),
};

const createPipelineSchema = z.object(pipelineFields);

const updatePipelineSchema = z
  .object(pipelineFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createPipelineHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createPipelineSchema, req.body);
    const pipeline = await createPipeline(req.auth.organizationId, input);
    res.status(201).json(pipeline);
  },
);

export const listPipelinesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listPipelines(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getPipelineHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const pipeline = await getPipelineById(req.auth.organizationId, id);
  res.status(200).json(pipeline);
});

export const updatePipelineHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updatePipelineSchema, req.body);
    const pipeline = await updatePipeline(req.auth.organizationId, id, input);
    res.status(200).json(pipeline);
  },
);

export const deletePipelineHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deletePipeline(req.auth.organizationId, id);
    res.status(204).send();
  },
);
