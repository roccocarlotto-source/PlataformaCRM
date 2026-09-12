import { ConversationChannel } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { runAgentTurn } from "../services/agentOrchestration.service";
import { resolveWidgetContact } from "../services/widgetContact.service";
import type { WidgetRequest } from "../types/widgetAuth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// POST /api/public/agents/:agentId/web/messages — el canal Web (paso 5b).
//
// Tipado sobre WidgetRequest, no AuthenticatedRequest: acá no hay usuario.
// Todo lo que identifica al llamador sale de req.widgetAuth, que
// authenticateEmbedToken ya resolvió contra la base; el :agentId de la URL
// se valida por forma pero la organización y el agente reales son los del
// token (el middleware ya exigió que coincidan).
// ---------------------------------------------------------------------------

const widgetAgentIdParamSchema = z.string().uuid("agentId inválido");

const widgetMessageSchema = z.object({
  // El id de sesión que el navegador genera y guarda. Se acepta tal cual
  // (hasta 200 caracteres): es un identificador opaco, no se interpreta.
  sessionId: z.string().trim().min(1, "sessionId es requerido").max(200),
  message: z
    .string()
    .trim()
    .min(1, "message es requerido")
    .max(4000, "message no puede superar los 4000 caracteres"),
});

export const sendWidgetMessageHandler = asyncHandler<WidgetRequest>(async (req, res: Response) => {
  parseOrThrow(widgetAgentIdParamSchema, req.params.agentId);
  const input = parseOrThrow(widgetMessageSchema, req.body);

  const contactId = await resolveWidgetContact(
    req.widgetAuth.organizationId,
    req.widgetAuth.agentId,
    req.widgetAuth.branchId,
    ConversationChannel.WEB,
    input.sessionId,
  );

  // Un AppError de runAgentTurn (agente que no opera en WEB, etc.) se
  // propaga tal cual: errorHandler ya lo traduce.
  const resultado = await runAgentTurn({
    organizationId: req.widgetAuth.organizationId,
    agentId: req.widgetAuth.agentId,
    contactId,
    channel: ConversationChannel.WEB,
    texto: input.message,
    externalThreadId: input.sessionId,
  });

  // PROYECCIÓN MÍNIMA, no el ResultadoDelTurno completo del endpoint ADMIN de
  // prueba (punto 6 de la nota de 5b): un visitante anónimo no ve toolCalls
  // ni el estado interno de la conversación. `respuesta` puede ser null si
  // la conversación ya estaba derivada a un humano y el agente no responde.
  res.status(200).json({
    conversationId: resultado.conversationId,
    respuesta: resultado.respuesta,
  });
});
