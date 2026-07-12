import { InvitationStatus } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { acceptInvitationSchema } from "../schemas/invitation.schema";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../services/invitation.service";
import type { AuthenticatedRequest, InvitationAcceptRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
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
// exactamente en el caso que este endpoint necesita resolver.
// verifyInvitationAcceptIdentity (middleware, montado en invitation.routes.ts
// antes de este handler) ya verificó el JWT de Supabase una sola vez y dejó
// la identidad en req.invitationAcceptIdentity — no se vuelve a verificar acá.
export const acceptInvitationHandler = asyncHandler<InvitationAcceptRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(acceptInvitationSchema, req.body);
    const user = await acceptInvitation(req.invitationAcceptIdentity, input);
    res.status(201).json(user);
  },
);
