import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import {
  MAX_LARGO_DEL_MENSAJE,
  MAX_TERMINOS_POR_LISTA,
  guardarMensajesDeSalud,
  historialDeMensajesDeSalud,
  obtenerMensajesDeSalud,
} from "../services/mensajesDeSalud.service";

// ---------------------------------------------------------------------------
// Mensajes de salud de una clínica (docs/rubros.md §5.3, D11 revisada). Solo
// ADMIN (lo exige la ruta); del módulo agenda_clinica, así que una automotora
// recibe 403 con motivo RUBRO. Las reglas de contenido (el teléfono en el de
// urgencia, los largos, los términos) las aplica el service.
// ---------------------------------------------------------------------------

// Un poco más ancho que lo que se guarda: el service recorta y da el 400 con
// el mensaje que entiende el ADMIN. Esto solo frena un body absurdo.
const textoSchema = z
  .string()
  .max(MAX_LARGO_DEL_MENSAJE * 2)
  .nullable();
const terminosSchema = z
  .array(z.string().max(200))
  .max(MAX_TERMINOS_POR_LISTA * 2, "Demasiados términos");

const mensajesDeSaludBodySchema = z
  .object({
    urgencyMessageText: textoSchema,
    clinicalMessageText: textoSchema,
    extraUrgencyTerms: terminosSchema,
    extraClinicalTerms: terminosSchema,
  })
  .strict();

const historialQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const obtenerMensajesDeSaludHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.status(200).json(await obtenerMensajesDeSalud(req.auth.organizationId));
  },
);

export const guardarMensajesDeSaludHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(mensajesDeSaludBodySchema, req.body);
    res
      .status(200)
      .json(await guardarMensajesDeSalud(req.auth.organizationId, req.auth.userId, input));
  },
);

export const historialDeMensajesDeSaludHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { page, pageSize } = parseOrThrow(historialQuerySchema, req.query);
    res.status(200).json(await historialDeMensajesDeSalud(req.auth.organizationId, page, pageSize));
  },
);
