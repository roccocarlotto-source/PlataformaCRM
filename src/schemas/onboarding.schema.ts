import { z } from "zod";

// Extraído de onboarding.controller.ts (M1): onboardingRateLimiter necesita
// el mismo schema para decidir qué requests cuentan contra el cupo (ver
// rateLimit.ts) — se comparte el objeto, no se redeclaran las reglas.
export const onboardingSchema = z.object({
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
