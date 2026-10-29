import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { esErrorDeConexionALaBase } from "../utils/prismaErrors";

// ---------------------------------------------------------------------------
// CON LA BASE CAÍDA, LOS WORKERS FRENAN.
//
// Sin esto, cada worker seguía su ritmo normal contra una base que no
// responde: el de turnos del agente, cada segundo. Resultado: cientos de
// líneas de error por minuto —justo cuando hay que leer los logs— y, al volver
// la base, todos los workers golpeándola a la vez.
//
// Es UN estado por proceso, porque la base es una sola. El primer worker que
// se encuentra con un error de conexión (utils/prismaErrors.ts) la marca
// caída y deja UNA línea de log. Desde ahí:
//   - cada worker saltea su pasada mientras siga caída (laBaseEstaCaida);
//   - una sola sonda (SELECT 1) la vuelve a probar con espera creciente,
//     de 5 s a 60 s;
//   - cuando la sonda pasa, la marca sana y deja otra línea de log. Los
//     workers retoman en su próxima pasada.
// ---------------------------------------------------------------------------

export const ESPERA_INICIAL_MS = 5_000;
export const ESPERA_MAXIMA_MS = 60_000;

export interface ConfiguracionDeLaEspera {
  // Lo que prueba si la base volvió. Resuelve si responde; rechaza si no.
  sondear: () => Promise<unknown>;
  programar?: (fn: () => void, ms: number) => void;
}

export interface EsperaDeLaBase {
  // Si `err` es la base que no responde, la marca caída (si no lo estaba ya) y
  // devuelve true: el que llama NO loguea su propio error. Si no, false.
  anotarSiLaBaseNoResponde(err: unknown): boolean;
  estaCaida(): boolean;
}

export function crearEsperaDeLaBase(config: ConfiguracionDeLaEspera): EsperaDeLaBase {
  const programar =
    config.programar ??
    ((fn: () => void, ms: number) => {
      // unref: una sonda pendiente no mantiene vivo el proceso al apagarlo.
      setTimeout(fn, ms).unref();
    });

  let caida = false;
  let espera = ESPERA_INICIAL_MS;

  const sondear = async () => {
    try {
      await config.sondear();
      caida = false;
      logger.info("La base volvió a responder: los workers retoman");
    } catch {
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
      programar(() => void sondear(), espera);
    }
  };

  return {
    anotarSiLaBaseNoResponde(err) {
      if (!esErrorDeConexionALaBase(err)) {
        return false;
      }
      if (!caida) {
        caida = true;
        espera = ESPERA_INICIAL_MS;
        logger.error(
          { err },
          "La base no responde: los workers frenan hasta que vuelva (se prueba cada 5 a 60 s)",
        );
        programar(() => void sondear(), espera);
      }
      return true;
    },
    estaCaida: () => caida,
  };
}

// Uno por proceso.
const espera = crearEsperaDeLaBase({ sondear: () => prisma.$queryRaw`SELECT 1` });

export function anotarSiLaBaseNoResponde(err: unknown): boolean {
  return espera.anotarSiLaBaseNoResponde(err);
}

export function laBaseEstaCaida(): boolean {
  return espera.estaCaida();
}
