import type { Response } from "express";
import { z } from "zod";
import { getConversationById, listConversations } from "../services/conversation.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md).
// Dos GET y nada más: el listado y el hilo de una. Mismo molde que
// automation.controller.ts para la query del listado.
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
