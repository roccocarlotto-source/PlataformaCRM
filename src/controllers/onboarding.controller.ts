import type { Request, Response } from "express";
import { onboardingOtpSchema, onboardingSchema } from "../schemas/onboarding.schema";
import { onboardOrganization, requestOnboardingOtp } from "../services/onboarding.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

// ALTO-2, paso 1: pedir el código de verificación.
//
// 202 y no 201: no se creó ningún recurso del CRM. Lo que hubo fue un email
// encolado, y el registro todavía no ocurrió.
//
// El cuerpo de la respuesta es el mismo exista o no una cuenta con ese email —
// ver requestOnboardingOtp. Un mensaje distinto por caso convertiría un endpoint
// público en un oráculo de enumeración de usuarios.
export const requestOnboardingOtpHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = onboardingOtpSchema.safeParse(req.body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  await requestOnboardingOtp(parsed.data);

  res.status(202).json({
    message:
      "Si el email es válido, te enviamos un código de 6 dígitos para completar el registro.",
  });
});

export const createOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const parsed = onboardingSchema.safeParse(req.body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new AppError(message, 400);
  }

  const result = await onboardOrganization(parsed.data);

  res.status(201).json(result);
});
