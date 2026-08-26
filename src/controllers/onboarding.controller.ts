import type { Request, Response } from "express";
import { onboardingSchema } from "../schemas/onboarding.schema";
import { onboardOrganization } from "../services/onboarding.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const createOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const parsed = onboardingSchema.safeParse(req.body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  const result = await onboardOrganization(parsed.data);

  res.status(201).json(result);
});
