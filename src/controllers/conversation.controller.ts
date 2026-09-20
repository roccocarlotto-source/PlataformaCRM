import type { Response } from "express";
import { z } from "zod";
import {
  generateConversationBrief,
  getConversationById,
  listConversations,
  updateConversationBrief,
} from "../services/conversation.service";
import { BRIEF_MAX_LENGTH } from "../services/conversationBrief.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md).
// Empezó con dos GET —el listado y el hilo de una— y el ítem 73 le sumó las
// dos escrituras del brief. Mismo molde que automation.controller.ts para la
// query del listado.
//
// Los enums se validan contra sus valores REALES de Prisma (ConversationStatus
// y ConversationChannel son cerrados en el schema), a diferencia de
// triggerType/actionType en Automation, que son strings libres cuyo catálogo
// vive en código y por eso los valida el service.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que agent/automation (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  // Busca por el CONTACTO (nombre, apellido o email), no dentro de los
  // mensajes — ver el comentario de buildWhere en
  // src/repositories/conversation.repository.ts.
  search: z.string().trim().min(1).optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  agentId: z.string().uuid("agentId inválido").optional(),
  contactId: z.string().uuid("contactId inválido").optional(),
  status: z.enum(["ACTIVE", "TRANSFERRED_TO_HUMAN", "CLOSED"]).optional(),
  channel: z.enum(["WHATSAPP", "WEB"]).optional(),
  // Por defecto, la bandeja: lo último que se movió, arriba.
  sortBy: z.enum(["lastMessageAt", "createdAt"]).default("lastMessageAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const listConversationsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listConversations(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getConversationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const conversation = await getConversationById(req.auth.organizationId, id);
    res.status(200).json(conversation);
  },
);

// ---------------------------------------------------------------------------
// El brief (ítem 73)
// ---------------------------------------------------------------------------

// `brief` es OBLIGATORIO en el body y admite null explícito, que es como se
// vacía. No es opcional a propósito: un PATCH `{}` sobre un recurso con un
// solo campo editable no significa nada, y aceptarlo en silencio dejaría a la
// pantalla sin saber si guardó algo. `.nullable()` sin `.optional()` es
// exactamente esa regla.
//
// El tope es el mismo que recorta lo que escribe el modelo
// (BRIEF_MAX_LENGTH), importado y no repetido: un texto a mano y uno generado
// entran en la misma columna, así que no pueden tener dos límites distintos.
const updateBriefSchema = z.object({
  brief: z
    .string()
    .max(BRIEF_MAX_LENGTH, `El resumen no puede superar los ${BRIEF_MAX_LENGTH} caracteres`)
    .nullable(),
});

export const updateConversationBriefHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const { brief } = parseOrThrow(updateBriefSchema, req.body);
    const conversation = await updateConversationBrief(
      req.auth.organizationId,
      id,
      req.auth.userId,
      brief,
    );
    res.status(200).json(conversation);
  },
);

// SIN BODY: no hay nada que elegir. El transcript sale de la conversación y el
// prompt es fijo (ver conversationBrief.service.ts), así que un parámetro acá
// sería una opción que nadie puede usar.
//
// SÍNCRONO, a diferencia del disparador automático del handoff: quien apretó
// el botón espera ver el resumen, y un error tiene que llegarle como error.
export const generateConversationBriefHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const conversation = await generateConversationBrief(req.auth.organizationId, id);
    res.status(200).json(conversation);
  },
);
