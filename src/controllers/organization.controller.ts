import type { Response } from "express";
import { z } from "zod";
import {
  getOrganizationSettings,
  updateOrganizationCurrency,
} from "../services/organization.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { currencySchema, parseOrThrow } from "../utils/validation";

// Cada moneda es opcional Y nullable: null = "des-configurar esa moneda",
// mismo patrón que expectedCloseDate en updateOpportunitySchema. Cuando no es
// null, es el mismo ISO 4217 de tres letras que Opportunity.currency
// (currencySchema, compartido en utils/validation.ts).
//
// Exportado para fijar con tests unitarios (sin base) qué rechaza el borde.
export const updateOrganizationCurrencySchema = z
  .object({
    preferredCurrency: currencySchema.nullable().optional(),
    alternateCurrency: currencySchema.nullable().optional(),
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

export const updateOrganizationCurrencyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(updateOrganizationCurrencySchema, req.body);
    const settings = await updateOrganizationCurrency(req.auth.organizationId, input);
    res.status(200).json(settings);
  },
);
