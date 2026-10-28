import { logger } from "../lib/logger";
import {
  fechaDeCorteDePreguntas,
  purgarPreguntasViejas,
} from "../repositories/helpAssistantQuestion.repository";
import {
  fechaDeCorteDelAgenteInterno,
  purgarMensajesViejosDelAgenteInterno,
} from "../repositories/internalAgent.repository";

// ---------------------------------------------------------------------------
// La retención de las preguntas al asistente "¿Cómo se hace?": una vez por
// día borra las de más de 90 días (DIAS_DE_RETENCION_DE_PREGUNTAS).
//
// Desde el 2026-10-26, en la misma pasada, los mensajes del agente interno de
// más de 90 días (DIAS_DE_RETENCION_DEL_AGENTE_INTERNO; DAT-03 de
// docs-privados/auditoria-2026-10-21/informe.md, local): son el mismo tipo de
// texto —lo que un usuario escribe sobre clientes— y antes no tenían plazo.
//
// UN WORKER Y NO UN SCRIPT MANUAL, a diferencia de purge:llm-turn-usages y las
// otras purgas. Esas borran registros técnicos y da igual si se corren tarde;
// estas filas son texto que escribió un usuario, y el plazo de 90 días es una
// promesa que no puede depender de que alguien se acuerde de correr algo.
//
// Mismo molde que el barrido de vehículos vendidos: setTimeout encadenado,
// primera pasada inmediata (un deploy no corre el reloj un día) y un stop que
// espera la pasada en curso. Sin lock: con varias instancias, dos borran lo
// mismo y la segunda no encuentra nada.
// ---------------------------------------------------------------------------

const POLL_MS = 24 * 60 * 60 * 1000;

// Una pasada: las dos retenciones de 90 días. Exportada para el test
// (helpAssistantPurgeWorker.integration-test.ts). Devuelve cuántas filas borró.
export async function purgarTextosViejos(ahora: Date = new Date()): Promise<number> {
  return (
    (await purgarPreguntasViejas(fechaDeCorteDePreguntas(ahora))) +
    (await purgarMensajesViejosDelAgenteInterno(fechaDeCorteDelAgenteInterno(ahora)))
  );
}

export function iniciarPurgaDePreguntasDeAyuda(
  opciones: { pollMs?: number; purgar?: () => Promise<number> } = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  const purgar = opciones.purgar ?? (() => purgarTextosViejos());
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const borradas = await purgar();
        if (borradas > 0) logger.info({ borradas }, "Purga de preguntas al asistente de ayuda");
      } catch (err) {
        // Falló el borrado: se reintenta en la próxima pasada.
        logger.error({ err }, "Fallo en la purga de preguntas al asistente de ayuda");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Purga de preguntas al asistente de ayuda iniciada");
  timer = setTimeout(() => void tick(), 0);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
