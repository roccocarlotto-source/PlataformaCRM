import { ConversationChannel } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import {
  createAgent,
  deleteAgent,
  getAgentById,
  listAgents,
  updateAgent,
} from "../services/agent.service";
import {
  LLM_PROVIDER_NAMES,
  OPENROUTER_PROVIDER_NAME,
  isLlmProviderName,
} from "../services/llmProvider.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma, no literales a mano: si
// ConversationChannel cambia en schema.prisma, este schema se actualiza solo.
// Mismo patrón que resourceTypeSchema.
const channelSchema = z.nativeEnum(ConversationChannel, {
  errorMap: () => ({ message: "channels solo admite WHATSAPP o WEB" }),
});

// Sin duplicados: un agente con ["WEB", "WEB"] no es un error de negocio pero
// sí un dato sucio que cualquier consumidor tendría que limpiar. Se dedupe
// acá, una vez, conservando el orden.
function sinDuplicados<T>(valores: T[]): T[] {
  return Array.from(new Set(valores));
}

const channelsSchema = z.array(channelSchema).transform(sinDuplicados);

// Los nombres de tools del catálogo de §7 son snake_case ("create_opportunity",
// "get_availability"). Se valida la FORMA, no la pertenencia al catálogo: el
// catálogo vive en código y recién existe en 2b — validar contra él acá sería
// acoplar el CRUD a un archivo que todavía no está. Un nombre que no esté en el
// catálogo simplemente nunca se ofrece al modelo (paso 2 de §4 filtra por
// intersección), así que un typo es inofensivo pero visible.
const toolNameSchema = z
  .string()
  .trim()
  .min(1, "enabledTools no admite nombres vacíos")
  .max(100, "un nombre de tool no puede superar los 100 caracteres")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "cada tool de enabledTools debe ser snake_case (ej. create_opportunity)",
  );

const enabledToolsSchema = z.array(toolNameSchema).transform(sinDuplicados);

// Agent.modelProvider es VarChar libre en la base; el borde valida contra los
// adaptadores que existen (LLM_PROVIDER_NAMES). Ver la nota en
// llmProvider.service.ts.
const modelProviderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isLlmProviderName, {
    message: `modelProvider debe ser uno de: ${LLM_PROVIDER_NAMES.join(", ")}`,
  });

// modelName es libre a propósito: el catálogo de modelos cambia más rápido de
// lo que conviene versionar (comentario del schema y de OPENROUTER_MODEL). Un
// modelo inexistente falla con un 404 claro de OpenRouter al usarlo, no acá.
const modelNameSchema = z
  .string()
  .trim()
  .min(1, "modelName es requerido")
  .max(100, "modelName no puede superar los 100 caracteres");

// Objeto JSON plano. z.record rechaza arrays y null (parsedType distinto de
// "object"), que es exactamente la forma que §6 documenta para guardrails.
// El CONTENIDO no se valida acá: la forma de §6 es una convención documentada,
// no impuesta —mismo criterio que Contact.customFields—, y quien la lee es
// puedeEjecutarTool en 2b, que tiene que tolerar claves ausentes de todos
// modos.
const guardrailsSchema = z.record(z.string(), z.unknown(), {
  invalid_type_error: "guardrails debe ser un objeto JSON",
  required_error: "guardrails es requerido (puede ser {})",
});

const nameSchema = z
  .string()
  .trim()
  .min(1, "name es requerido")
  .max(200, "name no puede superar los 200 caracteres");

const goalSchema = z.string().trim().max(500, "goal no puede superar los 500 caracteres");

const instructionsSchema = z.string().trim().min(1, "instructions es requerido");

const toneSchema = z.string().trim().max(100, "tone no puede superar los 100 caracteres");

const createAgentSchema = z.object({
  branchId: z.string().uuid("branchId inválido"),
  name: nameSchema,
  goal: goalSchema.nullish(),
  instructions: instructionsSchema,
  tone: toneSchema.nullish(),
  // Con default los dos: el único adaptador que existe es OpenRouter y el
  // modelo por defecto ya está decidido en OPENROUTER_MODEL. Un POST con
  // branchId + name + instructions + guardrails alcanza para tener un agente
  // funcional; quien quiera otro modelo lo dice explícitamente.
  modelProvider: modelProviderSchema.default(OPENROUTER_PROVIDER_NAME),
  modelName: modelNameSchema.default(() => env.OPENROUTER_MODEL),
  enabledTools: enabledToolsSchema.default([]),
  channels: channelsSchema.default([]),
  guardrails: guardrailsSchema,
  isActive: z.boolean().optional(),
});

// Sin branchId: un Agent no cambia de sucursal — ver la nota en
// agent.service.ts. Que no esté en el schema es lo que convierte esa decisión
// en un 400 de validación y no en un campo que se ignora en silencio.
const updateAgentSchema = z
  .object({
    name: nameSchema,
    goal: goalSchema.nullable(),
    instructions: instructionsSchema,
    tone: toneSchema.nullable(),
    modelProvider: modelProviderSchema,
    modelName: modelNameSchema,
    enabledTools: enabledToolsSchema,
    channels: channelsSchema,
    guardrails: guardrailsSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que resource (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  // Llega como string en la query; "true"/"false" y nada más.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createAgentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const input = parseOrThrow(createAgentSchema, req.body);
  const agent = await createAgent(req.auth.organizationId, input);
  res.status(201).json(agent);
});

export const listAgentsHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  const result = await listAgents(req.auth.organizationId, query);
  res.status(200).json(result);
});

export const getAgentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const agent = await getAgentById(req.auth.organizationId, id);
  res.status(200).json(agent);
});

export const updateAgentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const input = parseOrThrow(updateAgentSchema, req.body);
  const agent = await updateAgent(req.auth.organizationId, id, input);
  res.status(200).json(agent);
});

export const deleteAgentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await deleteAgent(req.auth.organizationId, id);
  res.status(204).send();
});
