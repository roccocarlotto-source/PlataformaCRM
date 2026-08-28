import { Router } from "express";
import {
  createOnboarding,
  requestOnboardingOtpHandler,
} from "../controllers/onboarding.controller";
import { onboardingOtpRateLimiter, onboardingRateLimiter } from "../middlewares/rateLimit";

export const onboardingRouter = Router();

// ALTO-2 — el registro es de dos llamadas: primero se prueba el email, después
// se registra. Ver el encabezado de onboarding.service.ts.
//
// Su propio limiter y no el de onboarding: cada uno decide qué cuenta contra su
// cupo parseando SU schema (ver rateLimit.ts), y un body de solo `{ email }`
// nunca pasaría onboardingSchema — reusarlo habría dejado este endpoint sin
// límite efectivo. Y es el que MÁS lo necesita de los dos: es el único del
// sistema que dispara un email hacia una dirección arbitraria elegida por quien
// llama.
onboardingRouter.post("/onboarding/otp", onboardingOtpRateLimiter, requestOnboardingOtpHandler);

// Único registro público del sistema — sin authenticate, ver
// docs/authentication-architecture.md sección 1. onboardingRateLimiter
// (M1) va primero: rechaza con 429 antes de tocar Supabase/Postgres.
onboardingRouter.post("/onboarding", onboardingRateLimiter, createOnboarding);
