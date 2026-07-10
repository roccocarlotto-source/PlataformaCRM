import type { Request, Response } from "express";
import { checkHealth } from "../services/health.service";
import { asyncHandler } from "../utils/asyncHandler";

export const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  const health = await checkHealth();
  res.status(health.status === "ok" ? 200 : 503).json(health);
});
