import { env } from "../config/env";
import { logger } from "../lib/logger";
import { findDerivacionesSinRespuestaVencidas } from "../repositories/conversation.repository";
import {
  avisarSiNadieRespondio,
  type ResultadoDelAvisoAutomatico,
} from "../services/conversationReply.service";

// ---------------------------------------------------------------------------
// El aviso automático si nadie responde a una derivación.
//
// Antes, el aviso de "no hay nadie disponible, te contactamos más tarde" (#381)
// salía solo si alguien tocaba "Devolver al agente". Si nadie del equipo
// entraba, el cliente que pidió una persona quedaba esperando sin respuesta.
// Ahora, si una conversación queda derivada y ninguna persona le escribe en
// los minutos que pide su agente (Agent.unansweredHandoffNoticeMinutes; NULL o
// 0 = desactivado), esto hace lo mismo que "Devolver al agente" sin respuesta:
// el aviso (con el horario de la sucursal si está cerrada), la tarea, la marca
// "Pidió hablar con una persona · sin responder", y la conversación vuelve al
// agente.
//
// MISMO MOLDE QUE LOS WORKERS DE SEGUIMIENTO —polling in-process, setTimeout
// encadenado, arranque en server.ts detrás de workersHabilitados(), stop que
// espera la pasada en curso—, con una diferencia: no hay una cola propia ni un
// lease en una tabla. El "trabajo" es la conversación misma, y lo que en los
// otros hace el lease lo hacen dos cosas que ya existen:
//   - el lock de la conversación (conLockDeConversacion), el mismo que toman
//     responder, "Devolver al agente" y los turnos del agente: dos instancias
//     o una persona y el worker no deciden a la vez;
//   - el CAS de returnConversationToAgent: el aviso sale en la misma
//     transacción que pasa la conversación a ACTIVE, así que una derivación
//     tiene UN solo aviso, y ya ACTIVE no la vuelve a elegir ninguna pasada.
// Si la conversación se vuelve a derivar, transferredToHumanAt se renueva y
// cuenta como una derivación nueva.
//
// WhatsApp: el aviso sale solo con la ventana de 24 h abierta; cerrada, queda
// FAILED con el motivo, igual que en #381. Web y otros canales: el mismo
// criterio que #381 (entregaDelAviso).
// ---------------------------------------------------------------------------

export interface ResumenDelAviso {
  avisados: number;
  descartados: number;
  fallidos: number;
}

export interface OpcionesDelDrenado {
  // Solo para tests: el barrido de una organización.
  organizationId?: string;
  limite?: number;
  ahora?: Date;
  avisar?: (
    organizationId: string,
    conversationId: string,
    ahora: Date,
  ) => Promise<ResultadoDelAvisoAutomatico>;
}

// Una pasada: un lote de candidatas, y cada una se decide bajo su lock. Una
// que falla (la base, Meta) no frena a las demás y vuelve a ser candidata en
// la próxima pasada: hasta que el aviso no se guardó, la conversación sigue
// derivada y sin respuesta.
export async function drenarAvisosSinRespuesta(
  opciones: OpcionesDelDrenado = {},
): Promise<ResumenDelAviso> {
  const resumen: ResumenDelAviso = { avisados: 0, descartados: 0, fallidos: 0 };
  const avisar = opciones.avisar ?? avisarSiNadieRespondio;
  const candidatas = await findDerivacionesSinRespuestaVencidas(
    opciones.limite ?? env.AVISO_SIN_RESPUESTA_WORKER_BATCH_SIZE,
    { organizationId: opciones.organizationId },
  );
  for (const candidata of candidatas) {
    try {
      const resultado = await avisar(
        candidata.organizationId,
        candidata.id,
        opciones.ahora ?? new Date(),
      );
      if (resultado === "avisado") {
        resumen.avisados++;
      } else {
        resumen.descartados++;
      }
    } catch (err) {
      resumen.fallidos++;
      logger.error(
        { err, organizationId: candidata.organizationId, conversationId: candidata.id },
        "No se pudo mandar el aviso automático de una derivación sin respuesta: se reintenta en la próxima pasada",
      );
    }
  }
  return resumen;
}

// SOLO PARA TESTS, mismo contrato que los otros workers (detenerWorker.test.ts).
export interface OpcionesDelWorker {
  pollMs?: number;
  drenar?: () => Promise<ResumenDelAviso>;
}

export function iniciarWorkerDeAvisoSinRespuesta(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.AVISO_SIN_RESPUESTA_WORKER_ENABLED) {
    logger.info(
      "Worker del aviso automático sin respuesta deshabilitado por AVISO_SIN_RESPUESTA_WORKER_ENABLED",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.AVISO_SIN_RESPUESTA_WORKER_POLL_MS;
  const drenar = opciones.drenar ?? (() => drenarAvisosSinRespuesta());

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    tickEnCurso = (async () => {
      try {
        const resumen = await drenar();
        if (resumen.avisados + resumen.fallidos > 0) {
          logger.info(resumen, "Avisos automáticos de derivaciones sin respuesta");
        }
      } catch (err) {
        // Red de seguridad del bucle: si muere, los avisos dejan de salir en
        // silencio.
        logger.error({ err }, "Fallo inesperado en el barrido de derivaciones sin respuesta");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info(
    { pollMs, batchSize: env.AVISO_SIN_RESPUESTA_WORKER_BATCH_SIZE },
    "Worker del aviso automático sin respuesta iniciado",
  );

  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    await tickEnCurso;
  };
}
