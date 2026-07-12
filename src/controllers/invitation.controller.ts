import { InvitationStatus } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../services/invitation.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { extractBearerToken } from "../utils/bearerToken";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const roleSchema = z.enum(["ADMIN", "USER"]);
// z.nativeEnum sobre el enum real de Prisma — mismo criterio que
// activity.controller.ts con ActivityType, en vez de duplicar los valores
// de InvitationStatus a mano.
const statusSchema = z.nativeEnum(InvitationStatus);

const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email("email inválido")
    .max(255, "email no puede superar los 255 caracteres"),
  role: roleSchema,
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: statusSchema.optional(),
  sortBy: z.enum(["createdAt", "expiresAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const acceptInvitationSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "fullName es requerido")
    .max(255, "fullName no puede superar los 255 caracteres"),
  invitationId: z.string().uuid("invitationId inválido").optional(),
});

export const createInvitationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createInvitationSchema, req.body);
    const invitation = await createInvitation(
      req.auth.organizationId,
      req.auth.userId,
      input,
    );
    res.status(201).json(invitation);
  },
);

export const listInvitationsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listInvitations(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const revokeInvitationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const invitation = await revokeInvitation(req.auth.organizationId, id);
    res.status(200).json(invitation);
  },
);

// Sin authenticate: quien acepta todavía no tiene fila en public.users, así
// que el middleware estándar (resolveAuthContext) fallaría con 403
// exactamente en el caso que este endpoint necesita resolver. Solo se
// exige un JWT de Supabase válido (extractBearerToken + verificación
// dentro del service) — ver invitation.service.ts.
export const acceptInvitationHandler = asyncHandler<Request>(
  async (req, res: Response) => {
    const token = extractBearerToken(req);
    const input = parseOrThrow(acceptInvitationSchema, req.body);
    const user = await acceptInvitation(token, input);
    res.status(201).json(user);
  },
);
