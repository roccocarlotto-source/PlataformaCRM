import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import { resumenDelTaller } from "../services/dashboard.service";

// El resumen del taller (docs/servicios.md §4.7, S11). Llega acá solo con el
// módulo activado (el gate dentro de `authenticate`). Lo ven ADMIN y USER, con
// las sucursales de cada uno.

export const resumenQuerySchema = z.object({
  branchId: z.string().uuid("branchId inválido").optional(),
});

export const resumenDelTallerHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { branchId } = parseOrThrow(resumenQuerySchema, req.query);
    res.status(200).json(await resumenDelTaller(req.auth.organizationId, req.auth, branchId));
  },
);
