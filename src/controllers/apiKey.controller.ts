import type { Response } from "express";
import { z } from "zod";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../services/apiKey.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const createApiKeySchema = z.object({
  sourceId: z.string().uuid("sourceId inválido"),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sourceId: z.string().uuid("sourceId inválido").optional(),
  // Estado derivado de revokedAt, no una columna. Sin filtro se listan las
  // dos: una clave revocada sigue siendo información de auditoría.
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  sortBy: z.enum(["createdAt", "lastUsedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const listApiKeysHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listApiKeys(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

// La ÚNICA respuesta de todo el sistema que contiene una clave en claro, en el
// campo `key`. No se puede volver a obtener: no está persistida en ningún
// lado, solo su hash. El resto del objeto es la misma proyección pública que
// devuelve el listado.
export const createApiKeyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createApiKeySchema, req.body);
    const apiKey = await createApiKey(req.auth.organizationId, input);
    res.status(201).json(apiKey);
  },
);

// DELETE, no POST /:id/revoke, y NO idempotente: revocar dos veces da 409.
// Misma desviación —y mismo argumento— que DELETE /invitations/:id, que
// también representa una transición terminal sobre una fila que sobrevive.
// Tener dos convenciones distintas para la misma semántica sería peor que la
// desviación.
export const revokeApiKeyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const apiKey = await revokeApiKey(req.auth.organizationId, id);
    res.status(200).json(apiKey);
  },
);
