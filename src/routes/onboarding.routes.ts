import { Router } from "express";
import { createOnboarding } from "../controllers/onboarding.controller";
import { onboardingRateLimiter } from "../middlewares/rateLimit";

export const onboardingRouter = Router();

// Único registro público del sistema — sin authenticate, ver
// docs/authentication-architecture.md sección 1. onboardingRateLimiter
// (M1) va primero: rechaza con 429 antes de tocar Supabase/Postgres.
onboardingRouter.post("/onboarding", onboardingRateLimiter, createOnboarding);
