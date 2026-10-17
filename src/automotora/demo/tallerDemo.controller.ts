import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import { crearTallerDemo } from "./tallerDemo.service";

// ---------------------------------------------------------------------------
// POST /api/admin/organizations/taller-demo (docs/taller-demo.md). Detrás de
// authenticate + businessWriteRateLimiter + requirePlatformAdmin, como la
// Clínica Demo. El body no elige rubro, edición ni nombre: la demo es siempre
// "Taller Demo" (con un sufijo opcional), AUTOMOTORA y COMPLETA, con el
// módulo Servicios. Pide los tres usuarios.
// ---------------------------------------------------------------------------

const usuarioSchema = z
  .object({
    fullName: z
      .string({ required_error: "fullName es requerido" })
      .trim()
      .min(1, "fullName es requerido")
      .max(255, "fullName no puede superar los 255 caracteres"),
    email: z.string({ required_error: "email es requerido" }).trim().email("email inválido"),
  })
  .strict();

export const crearTallerDemoSchema = z
  .object({
    sufijo: z
      .string({ invalid_type_error: "sufijo debe ser un texto" })
      .trim()
      .max(60, "sufijo no puede superar los 60 caracteres")
      .optional(),
    usuarios: z
      .object({
        admin: usuarioSchema,
        vendedor: usuarioSchema,
        taller: usuarioSchema,
      })
      .strict(),
  })
  .strict();

export const crearTallerDemoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(crearTallerDemoSchema, req.body);
    res
      .status(201)
      .json(await crearTallerDemo(input, undefined, { platformAdminUserId: req.auth.userId }));
  },
);
