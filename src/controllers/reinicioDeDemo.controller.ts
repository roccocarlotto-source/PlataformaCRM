import type { Response } from "express";
import { z } from "zod";
import { reiniciarDemo } from "../services/reinicioDeDemo.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// POST /api/admin/organizations/:organizationId/demo/reiniciar (Clínica Demo,
// docs/rubros.md §12.3; Taller Demo, docs/taller-demo.md §4). Detrás de
// authenticate + businessWriteRateLimiter + requirePlatformAdmin. Sin body:
// borra los datos de uso de la demo y vuelve a cargar los de ejemplo. 400 si la
// organización no es una demo.
const organizationIdSchema = z.string().uuid("organizationId inválido");

export const reiniciarDemoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdSchema, req.params.organizationId);
    res.status(200).json(await reiniciarDemo(organizationId));
  },
);
