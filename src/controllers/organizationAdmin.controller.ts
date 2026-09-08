import type { Response } from "express";
import { z } from "zod";
import { createOrganizationWithFoundingAdmin } from "../services/organizationAdmin.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Endpoint de platform admin para dar de alta una organización nueva con su
// primer ADMIN (Fase 4a del módulo SaaS). Corre detrás de authenticate +
// requirePlatformAdmin — NO authorize("ADMIN"), deliberado: ver
// middlewares/requirePlatformAdmin.ts. Mismo esqueleto que
// qrAdmin.controller.ts.
// ---------------------------------------------------------------------------

// Mismas reglas que onboarding.schema.ts para los campos equivalentes
// (organizationName / fullName / email). No se comparte el objeto porque el de
// onboarding arrastra password y otp, que acá no existen.
export const createOrganizationSchema = z.object({
  organizationName: z
    .string({ required_error: "organizationName es requerido" })
    .trim()
    .min(1, "organizationName es requerido")
    .max(255, "organizationName no puede superar los 255 caracteres"),
  adminFullName: z
    .string({ required_error: "adminFullName es requerido" })
    .trim()
    .min(1, "adminFullName es requerido")
    .max(255, "adminFullName no puede superar los 255 caracteres"),
  adminEmail: z.string({ required_error: "adminEmail es requerido" }).trim().email("adminEmail inválido"),
});

export const createOrganizationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createOrganizationSchema, req.body);
    const result = await createOrganizationWithFoundingAdmin(input);
    res.status(201).json(result);
  },
);
