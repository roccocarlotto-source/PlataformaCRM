import type { Response } from "express";
import { z } from "zod";
import {
  createEmbedToken,
  listEmbedTokens,
  revokeEmbedToken,
} from "../services/agentEmbedToken.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");
const tokenIdParamSchema = z.string().uuid("tokenId inválido");

// La ÚNICA respuesta del sistema que contiene un token de embed en claro, en
// el campo `token`. No se puede volver a obtener: no está persistido en
// ningún lado, solo su hash. Sin body: el token no tiene más configuración
// que el agente del que cuelga.
export const createEmbedTokenHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(idParamSchema, req.params.id);
    const created = await createEmbedToken(req.auth.organizationId, agentId);
    res.status(201).json(created);
  },
);

export const listEmbedTokensHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(idParamSchema, req.params.id);
    const data = await listEmbedTokens(req.auth.organizationId, agentId);
    res.status(200).json({ data });
  },
);

// DELETE, no POST /:tokenId/revoke, y NO idempotente: revocar dos veces da
// 409. Misma desviación —y mismo argumento— que DELETE /api-keys/:id.
export const revokeEmbedTokenHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(idParamSchema, req.params.id);
    const tokenId = parseOrThrow(tokenIdParamSchema, req.params.tokenId);
    const revoked = await revokeEmbedToken(req.auth.organizationId, agentId, tokenId);
    res.status(200).json(revoked);
  },
);
