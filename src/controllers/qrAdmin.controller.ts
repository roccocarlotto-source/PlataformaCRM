import type { Response } from "express";
import { z } from "zod";
import { adminSetQrSubscriptionStatus, setQrBillingExemption } from "../services/qrBilling.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Endpoints de platform admin del módulo QR (docs/qr-integration.md, Fase 2).
// Corren detrás de authenticate + requirePlatformAdmin — NO authorize("ADMIN"),
// deliberado: ver middlewares/requirePlatformAdmin.ts.
// ---------------------------------------------------------------------------

const organizationIdParamSchema = z.string().uuid("organizationId inválido");

// reason opcional acá: el original (admin_set_subscription_status) tenía
// p_reason default null. Vacío o solo espacios se guarda como null.
export const setQrSubscriptionStatusSchema = z.object({
  newStatus: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z
    .string()
    .trim()
    .max(500, "reason no puede superar los 500 caracteres")
    .nullable()
    .optional()
    .transform((valor) =>
      valor === undefined || valor === null || valor.length === 0 ? null : valor,
    ),
});

// reason OBLIGATORIO y no vacío, a diferencia del endpoint de arriba (DEC-061
// original): acá no existe un "source = webhook", cada fila es siempre una
// acción manual de un platform admin, así que siempre tiene que quedar dicho
// el motivo.
export const setQrBillingExemptionSchema = z.object({
  newValue: z.boolean({ required_error: "newValue es requerido" }),
  reason: z
    .string({ required_error: "reason es requerido" })
    .trim()
    .min(1, "reason es requerido")
    .max(500, "reason no puede superar los 500 caracteres"),
});

export const setQrSubscriptionStatusHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdParamSchema, req.params.organizationId);
    const input = parseOrThrow(setQrSubscriptionStatusSchema, req.body);
    const change = await adminSetQrSubscriptionStatus({
      organizationId,
      newStatus: input.newStatus,
      reason: input.reason,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(change);
  },
);

export const setQrBillingExemptionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdParamSchema, req.params.organizationId);
    const input = parseOrThrow(setQrBillingExemptionSchema, req.body);
    const change = await setQrBillingExemption({
      organizationId,
      newValue: input.newValue,
      reason: input.reason,
      platformAdminUserId: req.auth.userId,
    });
    res.status(200).json(change);
  },
);
