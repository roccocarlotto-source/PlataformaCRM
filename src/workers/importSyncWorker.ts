import { env } from "../config/env";
import { logger } from "../lib/logger";
import { reclamarSync } from "../repositories/importSync.repository";
import {
  correrSincronizacion,
  LOCK_DE_CORRIDA_MS,
  type ResultadoDeCorrida,
} from "../services/importacionSync.service";

// ---------------------------------------------------------------------------
// El worker de las sincronizaciones del stock desde Google Sheets
// (docs/importacion-de-datos.md §7). Mismo patrón que el resto (setTimeout
// encadenado, stop que espera la pasada en curso), por defecto cada 5 minutos.
//
// Correcto con más de una instancia y después de un reinicio: el reclamo y el
// lock están en la base (reclamarSync), y cuándo toca, cuántas veces falló y
// si está pausada viven en import_syncs, no en memoria (G-04/G-09 de las
// auditorías locales).
// ---------------------------------------------------------------------------

// Por pasada: cada corrida baja una planilla de hasta 10 MB.
const POR_PASADA = 10;

export async function procesarSincronizaciones(): Promise<Record<ResultadoDeCorrida, number>> {
  const resumen: Record<ResultadoDeCorrida, number> = {
    LOTE_CREADO: 0,
    FALLIDA: 0,
    ANTERIOR_EN_CURSO: 0,
  };
  for (let i = 0; i < POR_PASADA; i++) {
    const sync = await reclamarSync(LOCK_DE_CORRIDA_MS);
    if (!sync) break;
    resumen[await correrSincronizacion(sync)]++;
  }
  return resumen;
}

export function iniciarWorkerDeSincronizaciones(): () => Promise<void> {
  if (!env.IMPORT_SYNC_WORKER_ENABLED) {
    logger.info(
      "Worker de sincronizaciones deshabilitado por IMPORT_SYNC_WORKER_ENABLED: las planillas no se sincronizan",
    );
    return () => Promise.resolve();
  }
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const r = await procesarSincronizaciones();
        if (r.LOTE_CREADO + r.FALLIDA + r.ANTERIOR_EN_CURSO > 0) {
          logger.info(r, "Sincronizaciones de stock");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el worker de sincronizaciones");
      }
    })();
    await tickEnCurso;
    tickEnCurso = undefined;
    if (!detenido) timer = setTimeout(() => void tick(), env.IMPORT_SYNC_WORKER_POLL_MS);
  };

  timer = setTimeout(() => void tick(), env.IMPORT_SYNC_WORKER_POLL_MS);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
