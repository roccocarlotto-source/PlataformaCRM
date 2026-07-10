import type { Request, Response } from "express";
import { z } from "zod";
import { onboardOrganization } from "../services/onboarding.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

const onboardingSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(1, "organizationName es requerido")
    .max(255, "organizationName no puede superar los 255 caracteres"),
  fullName: z
    .string()
    .trim()
    .min(1, "fullName es requerido")
    .max(255, "fullName no puede superar los 255 caracteres"),
  email: z.string().trim().email("email inválido"),
  password: z.string().min(8, "password debe tener al menos 8 caracteres"),
});

export const createOnboarding = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = onboardingSchema.safeParse(req.body);

    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => issue.message)
        .join(", ");
      throw new AppError(message, 400);
    }

    const result = await onboardOrganization(parsed.data);

    res.status(201).json(result);
  },
);
