import type { Response } from "express";
import { z } from "zod";
import {
  createServiceType,
  deleteServiceType,
  getServiceTypeById,
  listServiceTypes,
  updateServiceType,
} from "../services/serviceType.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// durationMin > 0 y capacity >= 1 se validan también con un CHECK en la
// migración. No es redundancia ociosa: Zod cubre el borde HTTP, el CHECK cubre
// cualquier camino de escritura que no pase por acá — un script, un seed, un
// worker futuro. Mismo criterio que opportunities_amount_non_negative_check.
//
// El tope de 24 horas no sale de ninguna constraint: es una defensa contra el
// dedo resbalado (1440 en vez de 14). Un servicio más largo que un día existe
// —un retiro, una internación— pero no es lo que este módulo agenda hoy, y si
// aparece se sube el tope a conciencia en vez de descubrirlo por un turno de
// 100 días.
const durationSchema = z.coerce
  .number()
  .int("durationMin debe ser un entero")
  .positive("durationMin debe ser mayor que 0")
  .max(24 * 60, "durationMin no puede superar las 24 horas (1440 minutos)");

const capacitySchema = z.coerce
  .number()
  .int("capacity debe ser un entero")
  .min(1, "capacity debe ser al menos 1");

const createServiceTypeSchema = z.object({
  branchId: z.string().uuid("branchId inválido"),
  resourceId: z.string().uuid("resourceId inválido"),
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  durationMin: durationSchema,
  capacity: capacitySchema.optional(),
});

// branchId SÍ es actualizable acá, a diferencia de Resource — pero el service
// exige que venga acompañado de resourceId, porque el recurso viejo pertenece a
// la sucursal vieja. Misma regla y misma forma que updateOpportunity con
// pipelineId/stageId.
const updateServiceTypeSchema = z
  .object({
    branchId: z.string().uuid("branchId inválido"),
    resourceId: z.string().uuid("resourceId inválido"),
    name: z
      .string()
      .trim()
      .min(1, "name es requerido")
      .max(255, "name no puede superar los 255 caracteres"),
    durationMin: durationSchema,
    capacity: capacitySchema,
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
  branchId: z.string().uuid("branchId inválido").optional(),
  resourceId: z.string().uuid("resourceId inválido").optional(),
  sortBy: z.enum(["name", "createdAt", "durationMin"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createServiceTypeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createServiceTypeSchema, req.body);
    const serviceType = await createServiceType(req.auth.organizationId, input);
    res.status(201).json(serviceType);
  },
);

export const listServiceTypesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listServiceTypes(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getServiceTypeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const serviceType = await getServiceTypeById(req.auth.organizationId, id);
    res.status(200).json(serviceType);
  },
);

export const updateServiceTypeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateServiceTypeSchema, req.body);
    const serviceType = await updateServiceType(req.auth.organizationId, id, input);
    res.status(200).json(serviceType);
  },
);

export const deleteServiceTypeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteServiceType(req.auth.organizationId, id);
    res.status(204).send();
  },
);
