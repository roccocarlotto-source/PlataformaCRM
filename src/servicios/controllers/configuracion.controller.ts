import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { leerConfiguracionDelTaller } from "../repositories/workshopSettings.repository";

// GET /api/servicios/configuracion (docs/servicios.md §1.6, S2): la
// configuración del taller de la organización, de solo lectura. Sin fila,
// los defaults. Llega acá solo si la organización tiene el módulo activado: lo
// decide el gate dentro de `authenticate` (403 MODULO_NO_INCLUIDO con motivo
// NO_ACTIVADO si no).
export const leerConfiguracionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.status(200).json(await leerConfiguracionDelTaller(req.auth.organizationId));
  },
);
