import type { Response } from "express";
import { z } from "zod";
import { logAccesoADatosPersonales } from "../lib/accessLog";
import { listarEnviosQueNoSalieron } from "../services/enviosQueNoSalieron.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// La página tiene tope: page * pageSize no pasa de MAXIMO_DE_FILAS (1000).
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(20).default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
  branchId: z.string().guid("branchId inválido").optional(),
});

export const listEnviosQueNoSalieronHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);

    logAccesoADatosPersonales({
      auth: req.auth,
      recurso: "GET /api/envios-que-no-salieron",
      clase: "Sensitive",
      detalle: query.branchId ? { branchId: query.branchId } : {},
    });

    const result = await listarEnviosQueNoSalieron(req.auth.organizationId, req.auth, query);
    res.status(200).json(result);
  },
);
