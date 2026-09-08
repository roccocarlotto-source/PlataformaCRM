import { logger } from "../lib/logger";
import { upsertExchangeRate } from "../repositories/exchangeRate.repository";
import { findOrganizationsWithConfiguredCurrency } from "../repositories/organization.repository";
import { currenciesNeedingRate } from "./organization.service";

// ---------------------------------------------------------------------------
// Cotizaciones USD→X (Fase 2c del módulo de stock de vehículos). Lo llama el
// worker de cotizaciones una vez por día; no es un agente ni una integración
// por organización: es UNA búsqueda factual contra una API pública, y de ahí
// se guarda una fila por moneda que alguna organización configuró.
//
// FUENTE: open.er-api.com, sin API key, gratuita, sin límite documentado
// agresivo. Una sola llamada trae TODAS las monedas con base USD, así que no
// hay un fetch por moneda. La URL es una constante y no una env var por el
// mismo criterio que el bucket de Storage en 2b: no es secreto ni varía por
// ambiente.
//
// EL PAR ES SIEMPRE USD→DESTINO, nunca al revés. Si algún día hace falta la
// inversa se calcula al leer (1/rate), no se guarda una fila más.
// ---------------------------------------------------------------------------

export const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
export const EXCHANGE_RATE_BASE_CURRENCY = "USD";

export type RatesByCurrency = Record<string, number>;

interface RespuestaDeLaApi {
  result?: unknown;
  rates?: unknown;
}

export async function fetchRatesFromApi(): Promise<RatesByCurrency> {
  const res = await fetch(EXCHANGE_RATE_API_URL);
  if (!res.ok) {
    throw new Error(`La API de cotizaciones respondió ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as RespuestaDeLaApi;
  if (body.result !== "success" || typeof body.rates !== "object" || body.rates === null) {
    throw new Error(
      `La API de cotizaciones devolvió un cuerpo inesperado (result=${String(body.result)})`,
    );
  }
  return body.rates as RatesByCurrency;
}

export interface ResumenDeActualizacion {
  actualizadas: number;
  fallidas: number;
}

// SOLO PARA TESTS, mismo criterio que `cliente` en renovarCanalesVencidos:
// sin red real, el test inyecta las cotizaciones y el resto del ciclo —qué
// monedas buscar, el upsert, que una moneda que la fuente no trae no corte a
// las demás— se ejercita de verdad contra Postgres.
export interface OpcionesDeActualizacion {
  fetchRates?: () => Promise<RatesByCurrency>;
}

// La fecha de HOY sin hora, para la columna @db.Date — mismo patrón textual
// que ya usa el repo para fechas de calendario (día UTC).
export function rateDateDeHoy(now = new Date()): Date {
  return new Date(now.toISOString().slice(0, 10));
}

export async function fetchAndStoreExchangeRates(
  opciones: OpcionesDeActualizacion = {},
): Promise<ResumenDeActualizacion> {
  const organizaciones = await findOrganizationsWithConfiguredCurrency();
  const currencies = currenciesNeedingRate(
    organizaciones.flatMap((o) => [o.preferredCurrency, o.alternateCurrency]),
    EXCHANGE_RATE_BASE_CURRENCY,
  );

  // Ninguna organización configuró moneda todavía: no hay nada que buscar y
  // no se llama a la API. Mismo espíritu que "sin conexiones que necesiten
  // canal" en el worker de Google.
  if (currencies.length === 0) {
    return { actualizadas: 0, fallidas: 0 };
  }

  let rates: RatesByCurrency;
  try {
    rates = await (opciones.fetchRates ?? fetchRatesFromApi)();
  } catch (err) {
    // La fuente ENTERA falló (red caída, API rota): un solo log y todas las
    // monedas cuentan como fallidas. No tiene sentido reintentar moneda por
    // moneda cuando lo que no hay es la respuesta completa.
    logger.error({ err, currencies }, "No se pudieron obtener las cotizaciones de la fuente");
    return { actualizadas: 0, fallidas: currencies.length };
  }

  const rateDate = rateDateDeHoy();
  const fetchedAt = new Date();
  const resumen: ResumenDeActualizacion = { actualizadas: 0, fallidas: 0 };

  // Bucle FOR y no Promise.all: un fallo no corta a las demás, mismo criterio
  // que renovarCanalesVencidos.
  for (const targetCurrency of currencies) {
    const rate = rates[targetCurrency];
    if (typeof rate !== "number" || !(rate > 0)) {
      // Moneda mal escrita al configurarla, o no soportada por la fuente. Se
      // deja registrado y se sigue con la próxima.
      resumen.fallidas++;
      logger.warn({ targetCurrency }, "La fuente no trae cotización para esta moneda; se omite");
      continue;
    }
    try {
      await upsertExchangeRate({
        baseCurrency: EXCHANGE_RATE_BASE_CURRENCY,
        targetCurrency,
        rate,
        rateDate,
        fetchedAt,
      });
      resumen.actualizadas++;
    } catch (err) {
      resumen.fallidas++;
      logger.error(
        { err, targetCurrency },
        "No se pudo guardar la cotización de esta moneda; se sigue con las demás",
      );
    }
  }

  return resumen;
}
