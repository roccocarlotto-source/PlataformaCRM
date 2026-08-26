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
import { fieldMappingSchema } from "../schemas/fieldMapping.schema";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma — mismo criterio que
// activity.controller.ts con ActivityType, en vez de duplicar los valores a
// mano.
const sourceTypeSchema = z.nativeEnum(SourceType);

// fieldMapping SÍ figura acá desde el ítem 5, que es el que le dio forma
// (schemas/fieldMapping.schema.ts) y consumidor (la traducción de una fila de
// archivo). El ítem 3 la había excluido a propósito porque el documento la
// declaraba "JSONB" sin definir forma, claves ni consumidor, y aceptarla
// entonces habría sido inventar una estructura de datos.
//
// Solo tiene sentido en una fuente FILE_IMPORT y se RECHAZA en las demás, en vez
// de aceptarse y no consumirse nunca — el razonamiento completo está en
// updateSource (source.service.ts). Acá se valida el CREATE, donde `type` viaja
// en el mismo payload; el PATCH lo valida en el service, que es el único que
// puede leer el `type` de la fila.
const sourceFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  type: sourceTypeSchema,
  isActive: z.boolean().optional(),
};

const createSourceSchema = z
  .object({ ...sourceFields, fieldMapping: fieldMappingSchema.optional() })
  .superRefine((data, ctx) => {
    if (data.fieldMapping !== undefined && data.type !== SourceType.FILE_IMPORT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fieldMapping"],
        message:
          "fieldMapping solo se puede configurar en una fuente de tipo FILE_IMPORT",
      });
    }
  });

// El type de una Source no se cambia: una integración de webhook no se
// convierte en una importación de Excel, se crea otra. Dejarlo mutable
// obligaría a decidir qué pasa con los IngestionEvent ya ingeridos bajo el
// tipo anterior, y no hay respuesta buena.
const updateSourceSchema = z
  .object({
    name: sourceFields.name.optional(),
    isActive: sourceFields.isActive,
    // .nullable(): mandar null LIMPIA el mapeo, omitirlo lo deja intacto. Sin
    // esa distinción no habría forma de revertir una configuración.
    fieldMapping: fieldMappingSchema.nullable().optional(),
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
