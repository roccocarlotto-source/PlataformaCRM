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
  // ALTO-2 — el código que prueba que quien registra controla ese email. Sin
  // esto, `email_confirm: true` era una afirmación que nadie había verificado y
  // cualquiera podía quemar el email de una víctima para siempre.
  //
  // Largo exacto y no un rango: supabase/config.toml fija otp_length = 6, y un
  // schema más laxo solo serviría para que un código mal tipeado llegue hasta
  // Supabase en vez de rebotar acá.
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "otp debe ser el código de 6 dígitos que se envió por email"),
});

// Paso 1 del registro: pedir el código. Es un schema aparte y no un subconjunto
// del de arriba porque onboardingOtpRateLimiter lo usa para decidir qué cuenta
// contra su cupo, igual que onboardingSchema con el suyo — un body que no es ni
// siquiera un email válido no consume cupo de nadie.
export const onboardingOtpSchema = z.object({
  email: z.string().trim().email("email inválido"),
});
