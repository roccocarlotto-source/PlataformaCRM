import { ActivityType } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import {
  createActivity,
  deleteActivity,
  getActivityById,
  listActivities,
  updateActivity,
} from "../services/activity.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma: si ActivityType cambia en
// schema.prisma, este schema se actualiza solo, sin duplicar los valores a
// mano (a diferencia de OpportunityStatus en opportunity.controller.ts).
const activityTypeSchema = z.nativeEnum(ActivityType);

// Campos compartidos entre create y update que nunca cambian de
// nullability entre ambos (type nunca se limpia, subject nunca se limpia).
const activityFields = {
  type: activityTypeSchema,
  subject: z
    .string()
    .trim()
    .min(1, "subject es requerido")
    .max(255, "subject no puede superar los 255 caracteres"),
};

const createActivitySchema = z
  .object({
    ...activityFields,
    body: z.string().trim().min(1).optional(),
    dueDate: z.coerce.date().optional(),
    completedAt: z.coerce.date().optional(),
    assigneeId: z.string().uuid("assigneeId inválido").optional(),
    companyId: z.string().uuid("companyId inválido").optional(),
    contactId: z.string().uuid("contactId inválido").optional(),
    opportunityId: z.string().uuid("opportunityId inválido").optional(),
  })
  .refine(
    (data) => Boolean(data.companyId) || Boolean(data.contactId) || Boolean(data.opportunityId),
    {
      message: "Debe indicar companyId, contactId, opportunityId, o una combinación de estos",
    },
  );

// body/dueDate/completedAt/assigneeId/companyId/contactId/opportunityId son
// .nullable() acá (a diferencia de create): permiten limpiarse
// explícitamente. Sin .nullable(), z.coerce.date() convertiría un `null`
// explícito de dueDate/completedAt en 1970-01-01 en vez de limpiar el campo
// — mismo bug que se corrigió en Opportunity. La invariante "al menos una
// relación" no se puede validar acá (un PATCH puede no tocar ninguna de las
// tres relaciones y seguir siendo válido): se valida en el service contra el
// estado final (actual + payload) — ver activity.service.ts.
const updateActivitySchema = z
  .object({
    ...activityFields,
    body: z.string().trim().min(1).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
    assigneeId: z.string().uuid("assigneeId inválido").nullable().optional(),
    companyId: z.string().uuid("companyId inválido").nullable().optional(),
    contactId: z.string().uuid("contactId inválido").nullable().optional(),
    opportunityId: z.string().uuid("opportunityId inválido").nullable().optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z
  .object({
    // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
    page: z.coerce.number().int().positive().max(10_000).default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).optional(),
    type: activityTypeSchema.optional(),
    authorId: z.string().uuid("authorId inválido").optional(),
    assigneeId: z.string().uuid("assigneeId inválido").optional(),
    companyId: z.string().uuid("companyId inválido").optional(),
    contactId: z.string().uuid("contactId inválido").optional(),
    opportunityId: z.string().uuid("opportunityId inválido").optional(),
    dueDateFrom: z.coerce.date().optional(),
    dueDateTo: z.coerce.date().optional(),
    completedAtFrom: z.coerce.date().optional(),
    completedAtTo: z.coerce.date().optional(),
    // "true"/"false" explícitos, NO z.coerce.boolean(): Boolean("false") es
    // true, así que ?completed=false pediría las completadas. Mismo helper
    // que isActive en user.controller.ts.
    completed: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    sortBy: z
      .enum(["createdAt", "updatedAt", "dueDate", "completedAt", "subject"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine((data) => !data.dueDateFrom || !data.dueDateTo || data.dueDateFrom <= data.dueDateTo, {
    message: "dueDateFrom no puede ser posterior a dueDateTo",
    path: ["dueDateFrom"],
  })
  .refine(
    (data) =>
      !data.completedAtFrom || !data.completedAtTo || data.completedAtFrom <= data.completedAtTo,
    {
      message: "completedAtFrom no puede ser posterior a completedAtTo",
      path: ["completedAtFrom"],
    },
  );

export const createActivityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createActivitySchema, req.body);
    const activity = await createActivity(req.auth.organizationId, req.auth.userId, input);
    res.status(201).json(activity);
  },
);

export const listActivitiesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listActivities(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getActivityHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const activity = await getActivityById(req.auth.organizationId, id);
  res.status(200).json(activity);
});

export const updateActivityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateActivitySchema, req.body);
    // El actor real decide la autorización a nivel de recurso en el service
    // (ver activity.routes.ts: PATCH ya no lleva authorize("ADMIN")).
    const activity = await updateActivity(req.auth.organizationId, id, input, {
      userId: req.auth.userId,
      role: req.auth.role,
    });
    res.status(200).json(activity);
  },
);

export const deleteActivityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteActivity(req.auth.organizationId, id);
    res.status(204).send();
  },
);
