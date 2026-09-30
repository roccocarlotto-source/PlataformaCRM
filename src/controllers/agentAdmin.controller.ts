import type { Response } from "express";
import { z } from "zod";
import { modelNameSchema, modelProviderSchema } from "../schemas/agentModelConfig.schema";
import {
  asignarModeloDeAgente,
  asignarNumeroDeWhatsapp,
  asignarPaginaDeFacebook,
} from "../services/agent.service";
import { asignarModeloDeAgenteInterno } from "../services/internalAgent.service";
import { OPENROUTER_PROVIDER_NAME } from "../services/llmProvider.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import { whatsappPhoneNumberIdSchema } from "./agent.controller";

// ---------------------------------------------------------------------------
// Endpoints de platform admin para asignar el número de WhatsApp de un agente
// (ítem 127, A-01 de docs/auditoria-2026-09-24-punta-a-punta.md) y su página
// de Facebook (ítem 169, el mismo esquema calcado). Corren detrás
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

// El id de la página de Facebook (ítem 169): el id numérico que Meta muestra
// en la página (Información > Transparencia de la página, o en el panel de la
// app), NO el nombre ni la URL. Mismas reglas que whatsappPhoneNumberIdSchema,
// y por el mismo motivo: el webhook lo compara por igualdad exacta contra el
// id que manda Meta, así que solo dígitos; "" es null (un campo vaciado); el
// tope es el ancho de la columna. Vive acá y no en agent.controller.ts porque
// el CRUD del tenant no acepta el campo.
export const facebookPageIdSchema = z
  .string()
  .trim()
  .max(64, "facebookPageId no puede superar los 64 caracteres")
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || /^\d+$/.test(value), {
    message: "facebookPageId solo admite dígitos (es el ID de la página que muestra Meta)",
  })
  .nullable();

// Obligatorio, igual que el del número: un PUT que no dice qué página poner es
// un 400, no un "sin cambios". null libera la página.
export const asignarPaginaDeFacebookSchema = z.object({
  facebookPageId: facebookPageIdSchema,
});

export const asignarPaginaDeFacebookHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(agentIdParamSchema, req.params.agentId);
    const input = parseOrThrow(asignarPaginaDeFacebookSchema, req.body);
    const agent = await asignarPaginaDeFacebook({
      agentId,
      facebookPageId: input.facebookPageId,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(agent);
  },
);

// ---------------------------------------------------------------------------
// El modelo de IA (B-05 de docs-privados/auditoria-2026-09-24-punta-a-punta.md,
// local): lo elige solo la plataforma, que es la que paga el proveedor. Mismo
// esquema que el número y la página: el CRUD del tenant ya no lo cambia.
// modelProvider es opcional y vale OpenRouter (el único adaptador que existe);
// modelName es obligatorio, con las mismas reglas que tenía el CRUD.
// ---------------------------------------------------------------------------
export const asignarModeloSchema = z.object({
  modelProvider: modelProviderSchema.default(OPENROUTER_PROVIDER_NAME),
  modelName: modelNameSchema,
});

export const asignarModeloDeAgenteHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const agentId = parseOrThrow(agentIdParamSchema, req.params.agentId);
    const input = parseOrThrow(asignarModeloSchema, req.body);
    const agent = await asignarModeloDeAgente({
      agentId,
      ...input,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(agent);
  },
);

const organizationIdParamSchema = z.string().uuid("organizationId inválido");

export const asignarModeloDeAgenteInternoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdParamSchema, req.params.organizationId);
    const input = parseOrThrow(asignarModeloSchema, req.body);
    const agente = await asignarModeloDeAgenteInterno({
      organizationId,
      ...input,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(agente);
  },
);
