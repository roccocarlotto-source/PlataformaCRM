import type { Response } from "express";
import { z } from "zod";
import { asignarNumeroDeWhatsapp } from "../services/agent.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import { whatsappPhoneNumberIdSchema } from "./agent.controller";

// ---------------------------------------------------------------------------
// Endpoint de platform admin para asignar el número de WhatsApp de un agente
// (ítem 127, A-01 de docs/auditoria-2026-09-24-punta-a-punta.md). Corre detrás
// de authenticate + requirePlatformAdmin — NO authorize("ADMIN"), deliberado:
// ver middlewares/requirePlatformAdmin.ts. Mismo esqueleto que
// organizationAdmin.controller.ts.
// ---------------------------------------------------------------------------

const agentIdParamSchema = z.string().uuid("agentId inválido");

// El mismo schema del CRUD del tenant (solo dígitos, ≤40, "" → null). Acá es
// OBLIGATORIO —es nullable pero no optional—: un PUT que no dice qué número
// poner es un 400, no un "sin cambios". null libera el número.
export const asignarNumeroDeWhatsappSchema = z.object({
  whatsappPhoneNumberId: whatsappPhoneNumberIdSchema,
});

export const asignarNumeroDeWhatsappHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(agentIdParamSchema, req.params.agentId);
    const input = parseOrThrow(asignarNumeroDeWhatsappSchema, req.body);
    const agent = await asignarNumeroDeWhatsapp({
      agentId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(agent);
  },
);
