import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import { MEDIOS_DE_AVISO, obtenerAvisos, registrarAviso } from "../services/avisos.service";

// Avisar al cliente (docs/servicios.md §8.1, S12): el texto sugerido, la
// conversación de WhatsApp y los avisos de la orden; y "Marcar como avisado".
// ADMIN y USER, con el módulo (gate en `authenticate`).

const idParamSchema = z.string().uuid("id inválido");

export const avisoSchema = z
  .object({
    medio: z.enum(MEDIOS_DE_AVISO, {
      errorMap: () => ({ message: "medio tiene que ser TELEFONO, WHATSAPP o EN_PERSONA" }),
    }),
  })
  .strict();

export const obtenerAvisosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json(await obtenerAvisos(req.auth.organizationId, id));
  },
);

export const registrarAvisoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const { medio } = parseOrThrow(avisoSchema, req.body);
    res.status(201).json(await registrarAviso(req.auth.organizationId, req.auth.userId, id, medio));
  },
);
