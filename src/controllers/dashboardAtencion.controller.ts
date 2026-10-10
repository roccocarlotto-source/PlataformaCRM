import type { Response } from "express";
import { getDashboardDeAtencion } from "../services/dashboardAtencion.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import { revenueGranularitySchema } from "./opportunity.controller";

// GET /api/dashboard/atencion (docs/ediciones.md §6.4). La misma granularidad
// que el dashboard comercial (month | week | day, sin default: 400 si falta),
// para que el selector del inicio funcione igual en las dos ediciones.
export const getDashboardDeAtencionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const granularity = parseOrThrow(revenueGranularitySchema, req.query.granularity);
    res.status(200).json(await getDashboardDeAtencion(req.auth.organizationId, { granularity }));
  },
);
