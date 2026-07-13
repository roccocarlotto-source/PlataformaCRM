import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";

// Serializa req.auth (ya resuelto por el middleware authenticate contra
// Postgres, ver src/services/auth.service.ts) al contrato HTTP de
// GET /api/me. No hace ninguna query propia, no valida input (el endpoint
// no recibe ninguno) — la única responsabilidad de este controller es la
// traducción AuthContext -> response body.
export const getMeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { userId, email, fullName, organizationId, role } = req.auth;
    res.status(200).json({ id: userId, email, fullName, organizationId, role });
  },
);
