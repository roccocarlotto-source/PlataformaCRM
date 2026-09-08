import {
  findLatestExchangeRates,
  findOrganizationById,
  updateOrganizationCurrency as updateOrganizationCurrencyRepo,
} from "../repositories/organization.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Configuración de la organización expuesta por la API (Fase 2c del módulo de
// stock de vehículos): la moneda de preferencia y la alternativa, y la última
// cotización USD→X de cada una.
//
// LA RESPUESTA ES UN OBJETO ACOTADO, NUNCA EL ROW DE Organization. El row
// tiene campos de billing/QR internos (qrMercadopagoSubscriptionId,
// qrBillingExempt, nextVehicleStockNumber…) que no son parte de este contrato
// — mismo criterio que me.controller.ts, que serializa el AuthContext a mano
// en vez de devolver una fila de Prisma.
// ---------------------------------------------------------------------------

export interface OrganizationExchangeRate {
  targetCurrency: string;
  // Decimal y @db.Date se sirven como texto, igual que el resto del módulo
  // (vehicle.service.ts): "40.123456" y "YYYY-MM-DD".
  rate: string;
  rateDate: string;
}

export interface OrganizationSettings {
  id: string;
  name: string;
  preferredCurrency: string | null;
  alternateCurrency: string | null;
  exchangeRates: OrganizationExchangeRate[];
}

// Las monedas de las que hace falta cotización: las configuradas, sin
// repetir y sin "USD" — el par es siempre USD→destino y USD→USD no se guarda
// (el CHECK de exchange_rates lo prohíbe además). Exportada para probarla
// sin base; la reutiliza el worker con las monedas de todas las
// organizaciones.
export function currenciesNeedingRate(
  currencies: (string | null | undefined)[],
  base = "USD",
): string[] {
  const set = new Set<string>();
  for (const currency of currencies) {
    if (currency && currency !== base) {
      set.add(currency);
    }
  }
  return [...set];
}

export async function getOrganizationSettings(
  organizationId: string,
): Promise<OrganizationSettings> {
  const organization = await findOrganizationById(organizationId);
  if (!organization) {
    throw new AppError("Organización no encontrada", 404);
  }
  const rates = await findLatestExchangeRates(
    currenciesNeedingRate([organization.preferredCurrency, organization.alternateCurrency]),
  );
  return {
    id: organization.id,
    name: organization.name,
    preferredCurrency: organization.preferredCurrency,
    alternateCurrency: organization.alternateCurrency,
    exchangeRates: rates.map((row) => ({
      targetCurrency: row.targetCurrency,
      rate: row.rate.toString(),
      rateDate: row.rateDate.toISOString().slice(0, 10),
    })),
  };
}

export interface UpdateOrganizationCurrencyInput {
  // null = "des-configurar esa moneda"; undefined = no tocarla.
  preferredCurrency?: string | null;
  alternateCurrency?: string | null;
}

export const MONEDAS_IGUALES = "La moneda de preferencia y la alternativa no pueden ser la misma";

export async function updateOrganizationCurrency(
  organizationId: string,
  input: UpdateOrganizationCurrencyInput,
): Promise<OrganizationSettings> {
  const organization = await findOrganizationById(organizationId);
  if (!organization) {
    throw new AppError("Organización no encontrada", 404);
  }

  // Se valida con lo que la fila QUEDA (el body aplicado sobre lo actual), no
  // con el body solo: mandar solo alternateCurrency igual a la preferida ya
  // configurada también deja un par sin sentido.
  const preferred =
    input.preferredCurrency !== undefined
      ? input.preferredCurrency
      : organization.preferredCurrency;
  const alternate =
    input.alternateCurrency !== undefined
      ? input.alternateCurrency
      : organization.alternateCurrency;
  if (preferred !== null && alternate !== null && preferred === alternate) {
    throw new AppError(MONEDAS_IGUALES, 400);
  }

  await updateOrganizationCurrencyRepo(organizationId, input);
  return getOrganizationSettings(organizationId);
}
