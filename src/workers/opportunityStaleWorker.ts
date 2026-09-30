import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { findActiveAutomationsByTriggerForSweep } from "../repositories/automation.repository";
import { findStaleOpportunities } from "../repositories/opportunity.repository";
import {
  emitOutboxEvent,
  findOpportunityIdsWithEventSince,
} from "../repositories/outboxEvent.repository";
import {
  TRIGGER_OPPORTUNITY_STALE,
  configDeOportunidadEstancadaSchema,
} from "../services/automationTriggers";

// ---------------------------------------------------------------------------
// Worker de oportunidades estancadas (ítem 76 de
// docs/frontend-cambios-pendientes.md): el PRODUCTOR del trigger
// opportunity.stale del motor de automatizaciones.
//
// POR QUÉ UN WORKER, a diferencia de opportunity.won. "Ganada" es un cambio:
// opportunity.service.ts lo emite en la misma transacción del UPDATE, en el
// instante en que pasa. "Lleva N días sin movimiento" es un ESTADO al que se
// llega sin que nadie haga nada — no hay ningún request en el que emitirlo.
// Hay que ir a buscarlo, y eso es un barrido periódico.
//
// ESTE WORKER SOLO EMITE EVENTOS. No redacta nada, no crea Activities y no
// decide qué acción corre: emite un OutboxEvent opportunity.stale con
// { opportunityId, ownerId } —la misma forma que opportunity.won— y a partir
// de ahí todo es el camino que ya existía: el worker del outbox lo entrega, el
// dispatcher corre las reglas activas del trigger con su idempotencia por
// regla, y la acción (agent.draft_follow_up) hace el trabajo.
//
// CALCO de exchangeRateWorker.ts —setTimeout encadenado, arranca en server.ts,
// stop asíncrono que espera el tick en curso, primera pasada inmediata,
// cadencia de 24 horas— y por los mismos motivos, que no se repiten acá. Lo
// que vale la pena leer:
//
//   EL ANTI-REDRAFT VIVE EN LA CONSULTA (findStaleOpportunities). Una
//   oportunidad que sigue quieta cumple la condición todos los días; sin
//   memoria, generaría un borrador diario para siempre. La memoria es
//   Opportunity.lastStaleFollowUpDraftedAt, que la acción deja al día cuando
//   crea la Activity: el barrido solo toma las que no tienen marca o la tienen
//   ANTERIOR a su último movimiento real.
//
//   UN EVENTO POR OPORTUNIDAD POR DÍA (G-08, ver VENTANA_SIN_REPETIR_MS). Un
//   reinicio dispara una pasada inmediata, pero una oportunidad que ya
//   recibió su evento en las últimas 23 h no recibe otro. Y si igual llegaran
//   dos, el segundo es inofensivo: la acción relee la fila y, si ya hay un
//   borrador posterior al último movimiento, no hace nada.
//
//   UN EVENTO POR OPORTUNIDAD, NO POR REGLA. El dispatcher corre todas las
//   reglas activas del trigger para cada evento, así que emitir por regla
//   duplicaría. Por eso el CRUD admite UNA regla activa de opportunity.stale
//   por organización (TRIGGERS_DE_REGLA_UNICA); si una carrera dejara dos, acá
//   manda el MENOR daysWithoutActivity y se avisa en el log.
// ---------------------------------------------------------------------------

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// UNA VEZ POR DÍA, AUNQUE EL PROCESO REINICIE (G-08 de
// docs-privados/auditoria-2026-09-30-corta.md, local).
//
// La primera pasada es inmediata al arrancar, y Render Free reinicia el
// proceso cada vez que despierta. La marca anti-redraft evita borradores
// duplicados, pero no eventos: con el LLM caído (la acción no llega a poner la
// marca), cada despertada emitía un opportunity.stale nuevo por oportunidad →
// filas, reintentos y DEAD_LETTER multiplicados.
//
// Ahora una oportunidad que ya recibió un evento en la ventana de abajo no
// recibe otro, esté ese evento pendiente, procesado o muerto: la memoria es el
// propio outbox, sin columna nueva. Una hora menos que un día para que la
// pasada de mañana —que corre 24 h después del FIN de la de hoy— no la saltee
// por segundos. La consulta y la emisión van bajo un advisory lock por
// organización, así que dos procesos que arrancan a la vez tampoco duplican.
// ---------------------------------------------------------------------------
export const VENTANA_SIN_REPETIR_MS = 23 * 60 * 60 * 1000;

// Pura y exportada para probarla sin base.
export function sinEventoReciente<T extends { id: string }>(
  estancadas: T[],
  conEventoReciente: Set<string>,
): T[] {
  return estancadas.filter((oportunidad) => !conEventoReciente.has(oportunidad.id));
}

export interface ResumenDeBarrido {
  organizaciones: number;
  emitidos: number;
  fallidas: number;
}

// Las dos opciones son SOLO PARA TESTS, mismo criterio que
// OpcionesDeRenovacion en googleCalendarChannelWorker.ts:
//
//   - `organizationId`: acota el barrido a una organización. En producción
//     este worker recorre todas; en la suite —archivos en paralelo contra una
//     base compartida— un barrido sin alcance emitiría eventos en las
//     organizaciones de otros tests.
//   - `ahora`: el reloj contra el que se miden los días, para no tener que
//     esperar días reales ni tocar updatedAt más de lo necesario.
export interface OpcionesDeBarrido {
  organizationId?: string;
  ahora?: Date;
}

// El límite de "sin movimiento desde": ahora menos N días exactos (24 h cada
// uno), no "N días de calendario". Exportada para probarla sin base.
export function limiteDeEstancamiento(ahora: Date, diasSinMovimiento: number): Date {
  return new Date(ahora.getTime() - diasSinMovimiento * MS_POR_DIA);
}

// El umbral de cada organización: el menor daysWithoutActivity entre sus
// reglas activas del trigger. Con la regla única del CRUD es simplemente el de
// su regla. Una regla cuyo triggerConfig ya no pasa el schema se salta con un
// error en el log —no puede tumbar las de las demás organizaciones—. Exportada
// para probarla sin base.
export function umbralesPorOrganizacion(
  reglas: { id: string; organizationId: string; triggerConfig: unknown }[],
): Map<string, number> {
  const umbrales = new Map<string, number>();

  for (const regla of reglas) {
    const config = configDeOportunidadEstancadaSchema.safeParse(regla.triggerConfig);
    if (!config.success) {
      logger.error(
        {
          automationId: regla.id,
          organizationId: regla.organizationId,
          issues: config.error.issues.map((issue) => issue.message),
        },
        "Regla de opportunity.stale con un triggerConfig inválido: se saltea",
      );
      continue;
    }

    const previo = umbrales.get(regla.organizationId);
    if (previo !== undefined) {
      logger.warn(
        { organizationId: regla.organizationId, automationId: regla.id },
        "Más de una regla activa de opportunity.stale en la organización: manda el menor daysWithoutActivity",
      );
    }
    umbrales.set(
      regla.organizationId,
      previo === undefined
        ? config.data.daysWithoutActivity
        : Math.min(previo, config.data.daysWithoutActivity),
    );
  }

  return umbrales;
}

export async function barrerOportunidadesEstancadas(
  opciones: OpcionesDeBarrido = {},
): Promise<ResumenDeBarrido> {
  const ahora = opciones.ahora ?? new Date();
  const resumen: ResumenDeBarrido = { organizaciones: 0, emitidos: 0, fallidas: 0 };

  const reglas = await findActiveAutomationsByTriggerForSweep(TRIGGER_OPPORTUNITY_STALE, {
    organizationId: opciones.organizationId,
  });

  for (const [organizationId, dias] of umbralesPorOrganizacion(reglas)) {
    resumen.organizaciones++;
    try {
      const estancadas = await findStaleOpportunities(
        organizationId,
        limiteDeEstancamiento(ahora, dias),
      );
      if (estancadas.length === 0) {
        continue;
      }

      // UNA transacción por organización: o salen todos sus eventos o
      // ninguno, y el reintento es la pasada de mañana. Por evento sería lo
      // mismo con más viajes a la base — no hay ningún cambio de negocio que
      // acompañar, solo filas en la cola.
      const emitidas = await prisma.$transaction(async (tx) => {
        // G-08: ver VENTANA_SIN_REPETIR_MS.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`opportunity-stale:${organizationId}`}::text))`;
        const conEventoReciente = await findOpportunityIdsWithEventSince(
          organizationId,
          TRIGGER_OPPORTUNITY_STALE,
          new Date(ahora.getTime() - VENTANA_SIN_REPETIR_MS),
          tx,
        );
        const aEmitir = sinEventoReciente(estancadas, conEventoReciente);
        for (const oportunidad of aEmitir) {
          await emitOutboxEvent(
            {
              organizationId,
              eventType: TRIGGER_OPPORTUNITY_STALE,
              payload: { opportunityId: oportunidad.id, ownerId: oportunidad.ownerId },
            },
            tx,
          );
        }
        return aEmitir.length;
      });

      if (emitidas === 0) {
        continue;
      }
      resumen.emitidos += emitidas;
      logger.info(
        { organizationId, daysWithoutActivity: dias, emitidos: emitidas },
        "Oportunidades estancadas: eventos opportunity.stale emitidos",
      );
    } catch (err) {
      // UNA ORGANIZACIÓN QUE FALLA NO CORTA LA PASADA — mismo requisito que el
      // worker de canales para una sucursal.
      resumen.fallidas++;
      logger.error(
        { err, organizationId },
        "No se pudieron emitir los eventos de oportunidades estancadas de esta organización; se sigue con las demás",
      );
    }
  }

  return resumen;
}

// SOLO PARA TESTS: mismos nombres de convención que los otros workers, para
// probar en detenerWorker.test.ts que el stop espera al tick en curso.
export interface OpcionesDelWorker {
  pollMs?: number;
  barrer?: () => Promise<ResumenDeBarrido>;
}

// Devuelve el stop del worker. Es ASÍNCRONO: resuelve recién cuando no queda
// ninguna pasada en curso.
export function iniciarWorkerDeOportunidadesEstancadas(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.OPPORTUNITY_STALE_WORKER_ENABLED) {
    logger.info(
      "Worker de oportunidades estancadas deshabilitado por OPPORTUNITY_STALE_WORKER_ENABLED: las reglas de opportunity.stale no se disparan",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.OPPORTUNITY_STALE_WORKER_POLL_MS;
  const barrer = opciones.barrer ?? (() => barrerOportunidadesEstancadas());

  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) {
      return;
    }

    tickEnCurso = (async () => {
      try {
        const resumen = await barrer();

        if (resumen.emitidos + resumen.fallidas > 0) {
          logger.info(resumen, "Pasada de oportunidades estancadas");
        }
      } catch (err) {
        // Red de seguridad del bucle: barrerOportunidadesEstancadas ya atrapa
        // por organización, así que llegar acá es que falló la consulta de
        // reglas. El bucle NO puede morir por eso — si muere, las reglas de
        // opportunity.stale dejan de dispararse en silencio.
        logger.error({ err }, "Fallo inesperado en la pasada de oportunidades estancadas");
      }
    })();

    await tickEnCurso;

    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info({ pollMs }, "Worker de oportunidades estancadas iniciado");

  // Primera pasada inmediata, mismo criterio que el worker de cotizaciones:
  // con una cadencia de 24 horas, un deploy no tiene por qué correr el reloj
  // un día entero. Ojo: es inmediata respecto del ARRANQUE DEL PROCESO — una
  // regla creada con el servidor ya corriendo espera a la próxima pasada
  // (hasta 24 horas), y para una regla que se mide en días eso es aceptable.
  // Una pasada de más al arrancar no duplica nada: la marca anti-redraft y la
  // relectura de la acción lo impiden.
  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    await tickEnCurso;
  };
}
