import type { Response } from "express";
import { z } from "zod";
import {
  createAutomation,
  deleteAutomation,
  getAutomationById,
  listAutomations,
  updateAutomation,
} from "../services/automation.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// CRUD de /api/automations (docs/automations-architecture.md §8). Mismo molde
// que agent.controller.ts: acá se valida la FORMA del cuerpo; la pertenencia
// a los catálogos (triggerType conocido, actionType registrado, actionConfig
// que pasa el schema de esa acción) la decide automation.service.ts, porque
// depende de registros que viven en código y no de una lista fija de zod.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const nameSchema = z
  .string()
  .trim()
  .min(1, "name es requerido")
  .max(200, "name no puede superar los 200 caracteres");

// Solo la forma: VarChar(100) en la base, sin espacios alrededor. Si el string
// es un trigger real lo decide el service contra TRIGGERS_CONOCIDOS.
const triggerTypeSchema = z
  .string()
  .trim()
  .min(1, "triggerType es requerido")
  .max(100, "triggerType no puede superar los 100 caracteres");

const actionTypeSchema = z
  .string()
  .trim()
  .min(1, "actionType es requerido")
  .max(100, "actionType no puede superar los 100 caracteres");

// Objeto JSON plano: z.record rechaza arrays y null. El CONTENIDO lo valida
// el service contra el schema de la acción elegida — mismo reparto que
// guardrails en agent.controller.ts.
const actionConfigSchema = z.record(z.string(), z.unknown(), {
  invalid_type_error: "actionConfig debe ser un objeto JSON",
  required_error: "actionConfig es requerido",
});

// Misma forma que actionConfig, del lado del trigger (ítem 76). Opcional en el
// alta: un trigger sin configuración (opportunity.won) no la necesita, y el
// service valida el contenido contra el schema del trigger elegido.
const triggerConfigSchema = z.record(z.string(), z.unknown(), {
  invalid_type_error: "triggerConfig debe ser un objeto JSON",
});

const createAutomationSchema = z.object({
  name: nameSchema,
  triggerType: triggerTypeSchema,
  actionType: actionTypeSchema,
  actionConfig: actionConfigSchema,
  triggerConfig: triggerConfigSchema.optional(),
  isActive: z.boolean().optional(),
});

const updateAutomationSchema = z
  .object({
    name: nameSchema,
    triggerType: triggerTypeSchema,
    actionType: actionTypeSchema,
    actionConfig: actionConfigSchema,
    triggerConfig: triggerConfigSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que agent/resource (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  triggerType: triggerTypeSchema.optional(),
  // Llega como string en la query; "true"/"false" y nada más.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createAutomationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createAutomationSchema, req.body);
    const automation = await createAutomation(req.auth.organizationId, input);
    res.status(201).json(automation);
  },
);

export const listAutomationsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listAutomations(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getAutomationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const automation = await getAutomationById(req.auth.organizationId, id);
    res.status(200).json(automation);
  },
);

export const updateAutomationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateAutomationSchema, req.body);
    const automation = await updateAutomation(req.auth.organizationId, id, input);
    res.status(200).json(automation);
  },
);

export const deleteAutomationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteAutomation(req.auth.organizationId, id);
    res.status(204).send();
  },
);
