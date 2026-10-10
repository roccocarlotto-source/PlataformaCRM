import { logger } from "../../lib/logger";
import { cerrarTurnosVencidos } from "../services/atendido.service";

// ---------------------------------------------------------------------------
// El cierre automático de los turnos de clínica (docs/rubros.md §4.8, D6, R10):
// cada 15 minutos, los CONFIRMED que terminaron hace más de 3 h pasan a
// atendidos (cerrarTurnosVencidos). Mismo molde que los demás workers: vive con
// el proceso servidor detrás de la guarda de server.ts, y el stop espera al tick
// en curso (M-12 c). Una automotora nunca cambia sola: el barrido filtra por
// rubro.
// ---------------------------------------------------------------------------

const POLL_MS = 15 * 60 * 1000;

export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: () => Promise<{ cerrados: number }>;
}

export function iniciarWorkerDeCierreAutomatico(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  const drenar = opciones.drenar ?? (() => cerrarTurnosVencidos());
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const { cerrados } = await drenar();
        if (cerrados > 0) logger.info({ cerrados }, "Turnos de clínica cerrados automáticamente");
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en el cierre automático de turnos de clínica");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Worker del cierre automático de turnos de clínica iniciado");
  timer = setTimeout(() => void tick(), pollMs);

  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
