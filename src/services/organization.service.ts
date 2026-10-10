import type { ContactTerm, OrganizationEdition, OrganizationIndustry } from "@prisma/client";
import {
  guardarTerminoDelContacto,
  leerConfiguracionDeClinica,
} from "../clinicas/repositories/clinicSettings.repository";
import {
  findLatestExchangeRates,
  findOrganizationById,
  updateOrganizationSettings as updateOrganizationSettingsRepo,
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
// cotización USD→X de cada una. Desde F5-b (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)),
// también el país por defecto de los teléfonos.
//
// LA RESPUESTA ES UN OBJETO ACOTADO, NUNCA EL ROW DE Organization. El row
// tiene campos internos (slug, nextVehicleStockNumber…) que no son parte de
// este contrato
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
  // F5-b: código de país sin "+" ("598"), o null = sin país por defecto.
  defaultPhoneCountryCode: string | null;
  // T-01: zona IANA de la organización ("America/Montevideo"); "UTC" si
  // nunca se configuró. La usan el dashboard y la fecha de cierre.
  timezone: string;
  exchangeRates: OrganizationExchangeRate[];
  // Rubros (docs/rubros.md §1.1 y §3): la edición y el rubro, de solo lectura
  // (los cambia el platform admin), y el término del contacto, que el ADMIN
  // de una clínica elige acá. null en una automotora: no lo tiene.
  edition: OrganizationEdition;
  industry: OrganizationIndustry;
  contactTerm: ContactTerm | null;
}

export async function getOrganizationSettings(
  organizationId: string,
): Promise<OrganizationSettings> {
  const organization = await findOrganizationById(organizationId);
  if (!organization) {
    throw new AppError("Organización no encontrada", 404);
  }
  const [rates, clinica] = await Promise.all([
    findLatestExchangeRates(
      currenciesNeedingRate([organization.preferredCurrency, organization.alternateCurrency]),
    ),
    organization.industry === "CLINICA"
      ? leerConfiguracionDeClinica(organizationId)
      : Promise.resolve(null),
  ]);
  return {
    id: organization.id,
    name: organization.name,
    preferredCurrency: organization.preferredCurrency,
    alternateCurrency: organization.alternateCurrency,
    defaultPhoneCountryCode: organization.defaultPhoneCountryCode,
    timezone: organization.timezone,
    exchangeRates: rates.map((row) => ({
      targetCurrency: row.targetCurrency,
      rate: row.rate.toString(),
      rateDate: row.rateDate.toISOString().slice(0, 10),
    })),
    edition: organization.edition,
    industry: organization.industry,
    contactTerm: clinica?.contactTerm ?? null,
  };
}

export interface UpdateOrganizationSettingsInput {
  // null = "des-configurar esa moneda"; undefined = no tocarla.
  preferredCurrency?: string | null;
  alternateCurrency?: string | null;
  // F5-b. null = sacar el país por defecto; undefined = no tocarlo.
  defaultPhoneCountryCode?: string | null;
  // T-01. Zona IANA ya validada por el controller; undefined = no tocarla.
  timezone?: string;
  // Rubros (docs/rubros.md §3): solo en una clínica (400 en una automotora).
  contactTerm?: ContactTerm;
}

export const TERMINO_SOLO_EN_CLINICAS =
  "El término del contacto solo se configura en una organización del rubro clínica";

export const MONEDAS_IGUALES = "La moneda de preferencia y la alternativa no pueden ser la misma";

// SOLO PARA TESTS (§24): la búsqueda de cotización que se dispara tras
// guardar. Producción no pasa nada y usa fetchAndStoreExchangeRates.
export interface OpcionesDeActualizacionDeMoneda {
  actualizarCotizaciones?: () => Promise<ResumenDeActualizacion>;
}

export async function updateOrganizationSettings(
  organizationId: string,
  input: UpdateOrganizationSettingsInput,
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
  if (input.contactTerm !== undefined && organization.industry !== "CLINICA") {
    throw new AppError(TERMINO_SOLO_EN_CLINICAS, 400);
  }

  const { contactTerm, ...deLaOrganizacion } = input;
  if (Object.keys(deLaOrganizacion).length > 0) {
    await updateOrganizationSettingsRepo(organizationId, deLaOrganizacion);
  }
  if (contactTerm !== undefined) {
    await guardarTerminoDelContacto(organizationId, contactTerm);
  }

  // §24: la cotización de lo que QUEDÓ configurado se busca ahora, a pedido,
  // sin esperar al worker (cuya primera pasada fue al arrancar el proceso,
  // no al guardar esto). Sin await a propósito: no bloquea la respuesta, y
  // el desenlace se loguea adentro. El GET de abajo lee la base ANTES de que
  // la fuente conteste, así que esta respuesta normalmente no trae todavía
  // la cotización nueva; la trae el GET siguiente.
  //
  // Solo si el PATCH tocó alguna moneda: cambiar únicamente el país por
  // defecto de los teléfonos (F5-b) no tiene por qué consultar la fuente.
  if (input.preferredCurrency !== undefined || input.alternateCurrency !== undefined) {
    dispararActualizacionDeCotizaciones([preferred, alternate], opciones.actualizarCotizaciones);
  }

  return getOrganizationSettings(organizationId);
}
