import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  fetchAndStoreExchangeRates,
  type ResumenDeActualizacion,
} from "../services/exchangeRate.service";

// ---------------------------------------------------------------------------
// Worker de cotizaciones (Fase 2c del módulo de stock de vehículos): una vez
// por día busca la cotización USD→X de cada moneda que alguna organización
// configuró y la guarda en exchange_rates.
//
// CALCO de googleCalendarChannelWorker.ts —setTimeout encadenado, arranca en
// server.ts, stop asíncrono que espera el tick en curso— y por los mismos
// motivos, que no se repiten acá. Lo que cambia:
//
//   LA CADENCIA ES DE 24 HORAS. Es una cotización que la propia agencia usa
//   para redondear precios, no para operar con margen de segundos; una vez al
//   día alcanza de sobra. Y la primera pasada es INMEDIATA, por la misma razón
//   que en el worker de canales: una organización que configura su moneda hoy
//   no tiene por qué esperar 24 horas por la primera cotización.
//
//   NO HAY MÁS PRECONDICIÓN QUE EXCHANGE_RATE_WORKER_ENABLED. El worker de
//   Google necesita GOOGLE_WEBHOOK_URL; acá no hay nada que configurar: si
//   ninguna organización eligió moneda todavía, fetchAndStoreExchangeRates
//   vuelve sin llamar a la API, y ése es el "no hay nada que hacer".
//
//   NO HAY RECLAMO NI LOCK POR FILA. Con varias instancias, dos procesos
//   harían la misma pasada el mismo día y el upsert sobre la unique compuesta
//   hace que la segunda pise a la primera con el mismo valor: inofensivo.
// ---------------------------------------------------------------------------

// SOLO PARA TESTS: mismos nombres de convención que el worker de canales.
// Permite arrancar el bucle con una cadencia corta y una pasada controlada
// por el test, para probar que detener() espera al tick en curso sin base,
// sin red y sin timers reales.
export interface OpcionesDelWorker {
  pollMs?: number;
  actualizar?: () => Promise<ResumenDeActualizacion>;
}

// Devuelve el stop del worker. Es ASÍNCRONO: resuelve recién cuando no queda
// ninguna pasada en curso.
export function iniciarWorkerDeCotizaciones(opciones: OpcionesDelWorker = {}): () => Promise<void> {
  if (!env.EXCHANGE_RATE_WORKER_ENABLED) {
    logger.info(
      "Worker de cotizaciones deshabilitado por EXCHANGE_RATE_WORKER_ENABLED: no se actualizan cotizaciones y las organizaciones ven la última guardada",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.EXCHANGE_RATE_WORKER_POLL_MS;
  const actualizar = opciones.actualizar ?? (() => fetchAndStoreExchangeRates());

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  // La promesa del tick que está corriendo ahora mismo, si hay uno. Es lo que
  // el stop espera.
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    tickEnCurso = (async () => {
      try {
        const resumen = await actualizar();

        if (resumen.actualizadas + resumen.fallidas > 0) {
          logger.info(resumen, "Pasada de actualización de cotizaciones");
        }
      } catch (err) {
        // Red de seguridad del bucle: fetchAndStoreExchangeRates ya atrapa la
        // fuente y cada upsert, así que llegar acá significa que falló la
        // consulta de organizaciones. El bucle NO puede morir por eso — si
        // muere, las cotizaciones dejan de actualizarse en silencio.
        logger.error({ err }, "Fallo inesperado en la pasada de actualización de cotizaciones");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info({ pollMs }, "Worker de cotizaciones iniciado");

  // Primera pasada inmediata (ver la cabecera).
  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    // Si hay un tick corriendo AHORA MISMO, esto espera a que termine su `for`
    // completo antes de resolver — mismo criterio que los otros tres workers
    // (M-12 c): $disconnect() no puede llegar a mitad de una pasada.
    await tickEnCurso;
  };
}
