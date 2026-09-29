import type { Response } from "express";
import { z } from "zod";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "../services/organization.service";
import { CODIGO_DE_PAIS } from "../lib/telefono";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { currencySchema, parseOrThrow } from "../utils/validation";

// Cada moneda es opcional Y nullable: null = "des-configurar esa moneda",
// mismo patrón que expectedCloseDate en updateOpportunitySchema. Cuando no es
// null, es el mismo ISO 4217 de tres letras que Opportunity.currency
// (currencySchema, compartido en utils/validation.ts).
//
// Exportado para fijar con tests unitarios (sin base) qué rechaza el borde.
//
// defaultPhoneCountryCode (F5-b de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)): el
// código de país con el que se completan los teléfonos locales. De 1 a 3
// dígitos, sin "+" y sin 0 inicial —ningún código E.164 empieza con 0—; es
// CODIGO_DE_PAIS de lib/telefono.ts, el mismo que vuelve a chequear el
// helper. null lo saca.
export const updateOrganizationSettingsSchema = z
  .object({
    preferredCurrency: currencySchema.nullable().optional(),
    alternateCurrency: currencySchema.nullable().optional(),
    defaultPhoneCountryCode: z
      .string()
      .regex(
        CODIGO_DE_PAIS,
        "defaultPhoneCountryCode tiene que ser el código de país: de 1 a 3 dígitos, sin + y sin 0 inicial (por ejemplo 598)",
      )
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const getOrganizationSettingsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const settings = await getOrganizationSettings(req.auth.organizationId);
    res.status(200).json(settings);
  },
);

export const updateOrganizationSettingsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(updateOrganizationSettingsSchema, req.body);
    const settings = await updateOrganizationSettings(req.auth.organizationId, input);
    res.status(200).json(settings);
  },
);
