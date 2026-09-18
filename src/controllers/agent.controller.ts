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
import { translateGuardrailsText } from "../services/agentGuardrailsTranslation.service";
import { runAgentTurn } from "../services/agentOrchestration.service";
import {
  LLM_PROVIDER_NAMES,
  OPENROUTER_PROVIDER_NAME,
  isLlmProviderName,
} from "../services/llmProvider.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { normalizeOrigin } from "../utils/origin";
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

// El mismo objeto de §6, pero EN LAS PALABRAS DEL ADMIN (ítem 56). Es lo que
// la pantalla muestra y vuelve a editar; el enforcement sigue siendo 100%
// sobre `guardrails`. Requerido igual que él: un agente declara sus límites
// aunque sea con texto vacío, que es la contraparte exacta de `{}`. El tope es
// el mismo que el de `message` en testMessageSchema — es texto que va a viajar
// a un LLM.
const guardrailsTextSchema = z
  .string({
    invalid_type_error: "guardrailsText debe ser texto",
    required_error: 'guardrailsText es requerido (puede ser "")',
  })
  .trim()
  .max(4000, "guardrailsText no puede superar los 4000 caracteres");

// Orígenes desde los que el widget del canal Web puede escribirle al agente
// (paso 5a; nota del canal Web en §10). Cada entrada se valida y normaliza
// con utils/origin.ts —esquema + host, sin path, query, fragmento ni
// credenciales— y se guarda normalizada, para que el 5b compare el header
// Origin por igualdad exacta. Vacío ES VÁLIDO y es el estado que deshabilita
// el widget (fail-closed), no un error. Deduplicado después de normalizar:
// "https://Ejemplo.com" y "https://ejemplo.com/" son el mismo origen.
const originSchema = z
  .string()
  .trim()
  .max(255, "un origen no puede superar los 255 caracteres")
  .transform((value, ctx) => {
    const normalized = normalizeOrigin(value);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${value}" no es un origen válido: se espera esquema http/https + host, sin path (ej. https://ejemplo.com)`,
      });
      return z.NEVER;
    }
    return normalized;
  });

export const allowedOriginsSchema = z
  .array(originSchema)
  .max(50, "allowedOrigins no puede superar las 50 entradas")
  .transform(sinDuplicados);

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
  guardrailsText: guardrailsTextSchema,
  // Default vacío = widget deshabilitado (fail-closed). Ver allowedOriginsSchema.
  allowedOrigins: allowedOriginsSchema.default([]),
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
    guardrailsText: guardrailsTextSchema,
    allowedOrigins: allowedOriginsSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  })
  // VAN SIEMPRE JUNTOS, mismo tipo de regla que budgetAmount/budgetCurrency en
  // LEAD_PARAMETERS. Un PATCH que trajera solo uno de los dos dejaría el texto
  // que la pantalla muestra y el JSON que hace cumplir los guardrails diciendo
  // cosas distintas — el ADMIN leería sus palabras y el agente obedecería otra
  // cosa. Es el único desacople que este ítem no puede permitirse.
  .refine((data) => (data.guardrails === undefined) === (data.guardrailsText === undefined), {
    message: "guardrails y guardrailsText se actualizan juntos",
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

// ---------------------------------------------------------------------------
// POST /api/agents/guardrails/translate — el traductor del ítem 56.
//
// NO GUARDA NADA, y esa es su forma: recibe el texto del ADMIN, devuelve el
// objeto de §6 que se entendió más lo que hubo que descartar, y la pantalla
// se lo muestra para que confirme ANTES de crear o editar el agente. El
// create/update que viene después recibe ese mismo objeto ya confirmado y NO
// vuelve a traducir: una segunda llamada al modelo podría dar otro resultado, y
// lo que se guarda tiene que ser exactamente lo que el ADMIN vio y aceptó.
//
// ADMIN como el resto de las escrituras de Agent, aunque no escriba: dispara
// una llamada real y paga a un LLM. No es una lectura abierta.
// ---------------------------------------------------------------------------
const translateGuardrailsSchema = z.object({
  text: z.string().trim().max(4000, "el texto no puede superar los 4000 caracteres"),
});

export const translateGuardrailsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(translateGuardrailsSchema, req.body);
    const resultado = await translateGuardrailsText(input.text);
    res.status(200).json(resultado);
  },
);

export const deleteAgentHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await deleteAgent(req.auth.organizationId, id);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /api/agents/:id/test-message — el endpoint interno de prueba del paso
// 2b (§9). Ejercita el loop de orquestación completo con un contacto real de
// la organización, ANTES de que exista el canal Web público: un ADMIN puede
// ver qué contesta el agente y qué tools intentó usar sin publicar nada.
//
// Es un endpoint administrativo y NO un canal: lleva authenticate + authorize
// (ADMIN) como el resto del CRUD, y el canal por el que se simula la
// conversación es un parámetro (default WEB, el primer canal real del plan).
// ---------------------------------------------------------------------------
const testMessageSchema = z.object({
  contactId: z.string().uuid("contactId inválido"),
  message: z
    .string()
    .trim()
    .min(1, "message es requerido")
    .max(4000, "message no puede superar los 4000 caracteres"),
  channel: channelSchema.default(ConversationChannel.WEB),
});

export const testMessageHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const input = parseOrThrow(testMessageSchema, req.body);
  // 404 si el agente no es de esta organización — antes de tocar el contacto,
  // para no revelar nada sobre contactos ajenos en el mensaje de error.
  await getAgentById(req.auth.organizationId, id);
  const resultado = await runAgentTurn({
    organizationId: req.auth.organizationId,
    agentId: id,
    contactId: input.contactId,
    channel: input.channel,
    texto: input.message,
  });
  res.status(200).json(resultado);
});
