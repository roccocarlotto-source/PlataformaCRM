import { SourceType } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import {
  createSource,
  deleteSource,
  getSourceById,
  listSources,
  updateSource,
} from "../services/source.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma — mismo criterio que
// activity.controller.ts con ActivityType, en vez de duplicar los valores a
// mano.
const sourceTypeSchema = z.nativeEnum(SourceType);

// fieldMapping NO figura acá, ni en create ni en update, y es deliberado: el
// documento de ingesta la declara "JSONB" sin definir forma, claves ni
// consumidor. La define el ítem 4. Aceptarla ahora sería inventar una
// estructura de datos.
const sourceFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  type: sourceTypeSchema,
  isActive: z.boolean().optional(),
};

const createSourceSchema = z.object(sourceFields);

// El type de una Source no se cambia: una integración de webhook no se
// convierte en una importación de Excel, se crea otra. Dejarlo mutable
// obligaría a decidir qué pasa con los IngestionEvent ya ingeridos bajo el
// tipo anterior, y no hay respuesta buena.
const updateSourceSchema = z
  .object({
    name: sourceFields.name.optional(),
    isActive: sourceFields.isActive,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Se requiere al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  type: sourceTypeSchema.optional(),
  // Los query params llegan como string: "true"/"false" se coaccionan a
  // boolean explícitamente en vez de con z.coerce.boolean(), que mapea
  // cualquier string no vacío a true (incluido "false").
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const listSourcesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listSources(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getSourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const source = await getSourceById(req.auth.organizationId, id);
    res.status(200).json(source);
  },
);

export const createSourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createSourceSchema, req.body);
    const source = await createSource(req.auth.organizationId, input);
    res.status(201).json(source);
  },
);

export const updateSourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateSourceSchema, req.body);
    const source = await updateSource(req.auth.organizationId, id, input);
    res.status(200).json(source);
  },
);

export const deleteSourceHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteSource(req.auth.organizationId, id);
    res.status(204).send();
  },
);
