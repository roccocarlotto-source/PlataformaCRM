import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import { crearClinicaDemo } from "./clinicaDemo.service";

// ---------------------------------------------------------------------------
// POST /api/admin/organizations/clinica-demo (docs/rubros.md §12.1, R19).
// Detrás de authenticate + requirePlatformAdmin, como el resto del alta de
// organizaciones. El body no elige rubro, edición ni nombre: la demo es
// siempre "Clínica Demo" (con un sufijo opcional), CLINICA y ESENCIAL.
// ---------------------------------------------------------------------------

export const crearClinicaDemoSchema = z
  .object({
    adminFullName: z
      .string({ required_error: "adminFullName es requerido" })
      .trim()
      .min(1, "adminFullName es requerido")
      .max(255, "adminFullName no puede superar los 255 caracteres"),
    adminEmail: z
      .string({ required_error: "adminEmail es requerido" })
      .trim()
      .email("adminEmail inválido"),
    sufijo: z
      .string({ invalid_type_error: "sufijo debe ser un texto" })
      .trim()
      .max(60, "sufijo no puede superar los 60 caracteres")
      .optional(),
  })
  .strict();

export const crearClinicaDemoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(crearClinicaDemoSchema, req.body);
    res.status(201).json(await crearClinicaDemo(input));
  },
);
