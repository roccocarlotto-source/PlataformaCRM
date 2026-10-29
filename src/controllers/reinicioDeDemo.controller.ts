import type { Response } from "express";
import { z } from "zod";
import { estadoDelReinicioDeDemo, iniciarReinicioDeDemo } from "../services/reinicioDeDemo.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// POST /api/admin/organizations/:organizationId/demo/reiniciar (Clínica Demo,
// docs/rubros.md §12.3; Taller Demo, docs/taller-demo.md §4). Detrás de
// authenticate + businessWriteRateLimiter + requirePlatformAdmin. Sin body:
// valida y arranca en segundo plano el borrado de los datos de uso y la
// recarga de los de ejemplo (src/services/reinicioDeDemo.service.ts). 202 con
// el estado; 400 si la organización no es una demo, 409 si ya se está
// reiniciando o algo impide la recarga.
const organizationIdSchema = z.string().guid("organizationId inválido");

export const reiniciarDemoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdSchema, req.params.organizationId);
    res.status(202).json(await iniciarReinicioDeDemo(organizationId));
  },
);

// GET /api/admin/organizations/:organizationId/demo/reinicio: en qué quedó el
// último reinicio de esa demo (NINGUNO, REINICIANDO, LISTO o FALLO). Misma
// cadena. No lee la base: el estado vive en memoria.
export const estadoDelReinicioDeDemoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdSchema, req.params.organizationId);
    res.status(200).json(estadoDelReinicioDeDemo(organizationId));
  },
);
