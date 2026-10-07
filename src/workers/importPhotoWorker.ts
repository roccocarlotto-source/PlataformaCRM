import { env } from "../config/env";
import { logger } from "../lib/logger";
import { reclamarFoto } from "../repositories/vehiclePhotoImport.repository";
import {
  descargarFotoPublica,
  procesarFoto,
  type Descargar,
} from "../services/importacionFotos.service";

// ---------------------------------------------------------------------------
// El worker de las fotos del stock importado (docs/importacion-de-datos.md
// §6). Mismo patrón que el resto (setTimeout encadenado, stop que espera la
// pasada en curso). Baja hasta CONCURRENCIA fotos a la vez y, en cada pasada,
// hasta POR_PASADA: comparte la máquina con la API (G-04: con dos réplicas
// serían el doble a la vez, un tope de carga y no de corrección).
//
// Correcto con más de una instancia: el reclamo es por fila con lease en la
// base (reclamarFoto), y un proceso que muere a mitad de una descarga deja la
// foto reclamable cuando vence el lease.
// ---------------------------------------------------------------------------

export const CONCURRENCIA_DE_FOTOS = 3;
const POR_PASADA = 30;
// Lo que tarda una descarga en el peor caso (15 s) con holgura para guardarla.
export const LEASE_DE_FOTO_MS = 2 * 60_000;

export interface ResumenDeFotos {
  bajadas: number;
  fallidas: number;
  omitidas: number;
  reintentos: number;
}

export async function procesarFotosPendientes(
  descargar: Descargar = descargarFotoPublica,
): Promise<ResumenDeFotos> {
  const resumen: ResumenDeFotos = { bajadas: 0, fallidas: 0, omitidas: 0, reintentos: 0 };
  let procesadas = 0;
  const hilo = async () => {
    while (procesadas < POR_PASADA) {
      const foto = await reclamarFoto(LEASE_DE_FOTO_MS);
      if (!foto) return;
      procesadas++;
      const r = await procesarFoto(foto, descargar);
      if (r === "DONE") resumen.bajadas++;
      else if (r === "FAILED") resumen.fallidas++;
      else if (r === "SKIPPED") resumen.omitidas++;
      else resumen.reintentos++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA_DE_FOTOS }, hilo));
  return resumen;
}

export function iniciarWorkerDeFotosImportadas(): () => Promise<void> {
  if (!env.IMPORT_PHOTO_WORKER_ENABLED) {
    logger.info(
      "Worker de fotos importadas deshabilitado por IMPORT_PHOTO_WORKER_ENABLED: las fotos quedan en cola",
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
        const r = await procesarFotosPendientes();
        if (r.bajadas + r.fallidas + r.omitidas + r.reintentos > 0) {
          logger.info(r, "Fotos importadas");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el worker de fotos importadas");
      }
    })();
    await tickEnCurso;
    tickEnCurso = undefined;
    if (!detenido) timer = setTimeout(() => void tick(), env.IMPORT_PHOTO_WORKER_POLL_MS);
  };

  timer = setTimeout(() => void tick(), env.IMPORT_PHOTO_WORKER_POLL_MS);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
