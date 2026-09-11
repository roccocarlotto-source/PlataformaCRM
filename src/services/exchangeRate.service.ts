import { env } from "../config/env";
import { logger } from "../lib/logger";
import { upsertExchangeRate } from "../repositories/exchangeRate.repository";
import { findOrganizationsWithConfiguredCurrency } from "../repositories/organization.repository";

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
//
// DOS DISPARADORES, UNA SOLA FUNCIÓN (§24 de docs/frontend-cambios-pendientes.md):
// el worker una vez por día, y updateOrganizationCurrency a pedido cada vez
// que una organización guarda su moneda. Sin lo segundo, la primera pasada
// "inmediata" del worker es inmediata respecto del ARRANQUE DEL PROCESO, no
// de cuándo se configuró la moneda: con el servidor ya corriendo, la primera
// cotización tardaba hasta 24 horas (o un reinicio a mano) en aparecer.
// ---------------------------------------------------------------------------

export const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
export const EXCHANGE_RATE_BASE_CURRENCY = "USD";

// Las monedas de las que hace falta cotización: las configuradas, sin
// repetir y sin la base — el par es siempre USD→destino y USD→USD no se
// guarda (el CHECK de exchange_rates lo prohíbe además). La usa el
// GET /organization con las dos monedas de una organización, la pasada
// completa con las de todas, y el disparo a pedido para decidir si hay algo
// que buscar. Exportada para probarla sin base.
export function currenciesNeedingRate(
  currencies: (string | null | undefined)[],
  base = EXCHANGE_RATE_BASE_CURRENCY,
): string[] {
  const set = new Set<string>();
  for (const currency of currencies) {
    if (currency && currency !== base) {
      set.add(currency);
    }
  }
  return [...set];
}

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

// ---------------------------------------------------------------------------
// Disparo A PEDIDO (§24): lo llama updateOrganizationCurrency con las monedas
// con las que QUEDA la organización, apenas commiteó el UPDATE.
//
// NO BLOQUEA AL CALLER. fetchAndStoreExchangeRates hace un fetch real a la
// API; esperarla haría que quien guarda su configuración espere esa llamada
// de red. Es fire-and-forget con el mismo criterio que el `void tick()` del
// worker: la promesa se suelta, pero su desenlace se loguea siempre —el
// resumen como info, con el mismo formato que la pasada del worker, y un
// rechazo como error— para que un fallo ni se pierda en silencio ni suba
// como unhandledRejection y tire abajo el proceso. Consecuencia asumida: la
// respuesta del PATCH normalmente todavía no trae la cotización nueva; la
// trae el GET siguiente.
//
// SIN CHEQUEO FINO de "¿esta moneda ya tenía cotización de hoy?": un solo
// fetch trae todas las monedas y el upsert es idempotente, así que llamar de
// más es barato. Lo único que se mira es si queda alguna moneda distinta de
// USD que buscar; y si el ambiente apagó las actualizaciones con
// EXCHANGE_RATE_WORKER_ENABLED=false, acá tampoco se le pega a la fuente —el
// mensaje que ese flag loguea ("las organizaciones ven la última guardada")
// tiene que seguir siendo verdad.
//
// Devuelve si disparó o no. `actualizar` es SOLO PARA TESTS, mismo criterio
// que `actualizar` en el worker.
export function dispararActualizacionDeCotizaciones(
  currencies: (string | null | undefined)[],
  actualizar: () => Promise<ResumenDeActualizacion> = () => fetchAndStoreExchangeRates(),
): boolean {
  const necesarias = currenciesNeedingRate(currencies);
  if (necesarias.length === 0) {
    return false;
  }
  if (!env.EXCHANGE_RATE_WORKER_ENABLED) {
    logger.info(
      { currencies: necesarias },
      "Actualización de cotizaciones a pedido omitida: EXCHANGE_RATE_WORKER_ENABLED=false",
    );
    return false;
  }

  void actualizar().then(
    (resumen) => {
      logger.info(resumen, "Pasada de actualización de cotizaciones a pedido");
    },
    (err: unknown) => {
      // Misma red de seguridad que el worker: fetchAndStoreExchangeRates ya
      // atrapa la fuente y cada upsert, así que llegar acá significa que
      // falló la consulta de organizaciones.
      logger.error({ err }, "Fallo inesperado en la actualización de cotizaciones a pedido");
    },
  );
  return true;
}
