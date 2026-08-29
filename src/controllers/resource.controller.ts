import { ResourceType } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import {
  createResource,
  deleteResource,
  getResourceById,
  listResources,
  updateResource,
} from "../services/resource.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma, no literales a mano: si
// ResourceType cambia en schema.prisma, este schema se actualiza solo. Es el
// patrón correcto que ALTO-12 señala como ya presente en activity.controller.ts
// e invitation.controller.ts — y el que NO se aplicó a LifecycleStage ni a
// OpportunityStatus. Esta entidad nace con él.
const resourceTypeSchema = z.nativeEnum(ResourceType, {
  errorMap: () => ({ message: "type debe ser PERSON, ROOM o CLASS" }),
});

const createResourceSchema = z.object({
  branchId: z.string().uuid("branchId inválido"),
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  type: resourceTypeSchema,
});

// Sin branchId: un Resource no cambia de sucursal — ver la nota en
// resource.service.ts. Que no esté en el schema es lo que convierte esa decisión
// en un 400 de validación y no en un campo que se ignora en silencio.
const updateResourceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name es requerido")
      .max(255, "name no puede superar los 255 caracteres"),
    type: resourceTypeSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  type: resourceTypeSchema.optional(),
  sortBy: z.enum(["name", "createdAt", "type"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createResourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createResourceSchema, req.body);
    const resource = await createResource(req.auth.organizationId, input);
    res.status(201).json(resource);
  },
);

export const listResourcesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listResources(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getResourceHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const resource = await getResourceById(req.auth.organizationId, id);
  res.status(200).json(resource);
});

export const updateResourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateResourceSchema, req.body);
    const resource = await updateResource(req.auth.organizationId, id, input);
    res.status(200).json(resource);
  },
);

export const deleteResourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteResource(req.auth.organizationId, id);
    res.status(204).send();
  },
);
