import {
  findLatestExchangeRates,
  findOrganizationById,
  updateOrganizationCurrency as updateOrganizationCurrencyRepo,
} from "../repositories/organization.repository";
import { AppError } from "../utils/AppError";
import {
  currenciesNeedingRate,
  dispararActualizacionDeCotizaciones,
  type ResumenDeActualizacion,
} from "./exchangeRate.service";

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

// SOLO PARA TESTS (§24): la búsqueda de cotización que se dispara tras
// guardar. Producción no pasa nada y usa fetchAndStoreExchangeRates.
export interface OpcionesDeActualizacionDeMoneda {
  actualizarCotizaciones?: () => Promise<ResumenDeActualizacion>;
}

export async function updateOrganizationCurrency(
  organizationId: string,
  input: UpdateOrganizationCurrencyInput,
  opciones: OpcionesDeActualizacionDeMoneda = {},
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

  // §24: la cotización de lo que QUEDÓ configurado se busca ahora, a pedido,
  // sin esperar al worker (cuya primera pasada fue al arrancar el proceso,
  // no al guardar esto). Sin await a propósito: no bloquea la respuesta, y
  // el desenlace se loguea adentro. El GET de abajo lee la base ANTES de que
  // la fuente conteste, así que esta respuesta normalmente no trae todavía
  // la cotización nueva; la trae el GET siguiente.
  dispararActualizacionDeCotizaciones([preferred, alternate], opciones.actualizarCotizaciones);

  return getOrganizationSettings(organizationId);
}
