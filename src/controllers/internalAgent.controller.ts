import type { Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import {
  enabledToolsSchema,
  modelNameSchema,
  modelProviderSchema,
} from "../schemas/agentModelConfig.schema";
import {
  getInternalAgent,
  listInternalAgentMessages,
  putInternalAgent,
} from "../services/internalAgent.service";
import { runInternalAgentTurn } from "../services/internalAgentOrchestration.service";
import { OPENROUTER_PROVIDER_NAME } from "../services/llmProvider.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// El agente de IA interno (ítem 179). Dos grupos de endpoints:
//
//   - /internal-agent/messages — el chat. authenticate +
//     requireInternalAgentAccess (ADMIN siempre, USER si canUseInternalAgent).
//   - /internal-agent — la configuración. Solo ADMIN.
// ---------------------------------------------------------------------------

// PUT = reemplazo completo del registro único. Con default los dos del modelo,
// mismo criterio que createAgentSchema: el único adaptador es OpenRouter y el
// modelo por defecto ya está decidido en OPENROUTER_MODEL.
const putInternalAgentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(200, "name no puede superar los 200 caracteres"),
  instructions: z.string().trim().min(1, "instructions es requerido"),
  modelProvider: modelProviderSchema.default(OPENROUTER_PROVIDER_NAME),
  modelName: modelNameSchema.default(() => env.OPENROUTER_MODEL),
  enabledTools: enabledToolsSchema.default([]),
});

// Mismo tope que el message de POST /agents/:id/test-message: es texto que va
// a viajar a un LLM.
const postMessageSchema = z.object({
  content: z
    .string({ required_error: "content es requerido" })
    .trim()
    .min(1, "content es requerido")
    .max(4000, "content no puede superar los 4000 caracteres"),
});

const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const getInternalAgentHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agente = await getInternalAgent(req.auth.organizationId);
    res.status(200).json(agente);
  },
);

export const putInternalAgentHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(putInternalAgentSchema, req.body);
    const agente = await putInternalAgent(req.auth.organizationId, input);
    res.status(200).json(agente);
  },
);

// Devuelve el mensaje del agente ya persistido (con su toolCalls de
// auditoría, si hubo), que es lo que el chat agrega debajo del de la persona.
export const postInternalAgentMessageHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(postMessageSchema, req.body);
    const { mensaje } = await runInternalAgentTurn({
      organizationId: req.auth.organizationId,
      userId: req.auth.userId,
      role: req.auth.role,
      userFullName: req.auth.fullName,
      texto: input.content,
    });
    res.status(200).json(mensaje);
  },
);

export const listInternalAgentMessagesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listMessagesQuerySchema, req.query);
    const result = await listInternalAgentMessages(req.auth.organizationId, req.auth.userId, query);
    res.status(200).json(result);
  },
);
