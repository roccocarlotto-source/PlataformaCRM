import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { findActiveAutomationsByTriggerForSweep } from "../repositories/automation.repository";
import { findStalledInquiries } from "../repositories/inquiryFollowUp.repository";
import {
  emitOutboxEvent,
  findPayloadIdsWithEventSince,
} from "../repositories/outboxEvent.repository";
import {
  TRIGGER_CONTACT_INQUIRY_STALLED,
  configDeConsultaSinAvanceSchema,
} from "../services/automationTriggers";

// ---------------------------------------------------------------------------
// Worker de consultas sin avance (ítem 185 de
// docs/frontend-cambios-pendientes.md): el PRODUCTOR del trigger
// contact.inquiry_stalled del motor de automatizaciones.
//
// CALCO de opportunityStaleWorker.ts, y por los mismos motivos: "lleva X días
// callado" es un ESTADO al que se llega sin que nadie haga nada, así que un
// barrido diario lo va a buscar; el worker SOLO EMITE EVENTOS (uno por
// contacto, con { contactId, conversationId, channel, branchId, ownerId,
// lastInboundAt }) y de ahí en adelante es el camino de siempre: outbox,
// dispatcher, la acción inquiry.follow_up.
//
// LA MEMORIA ANTI-REPETICIÓN VIVE EN LA CONSULTA (findStalledInquiries): la
// tabla inquiry_follow_ups dice cuántos seguimientos recibió el contacto
// desde su último mensaje y cuándo fue el último; sin eso, un contacto que
// sigue callado calificaría todos los días. Y, como en el de oportunidades,
// un evento por contacto y día aunque el proceso reinicie
// (VENTANA_SIN_REPETIR_MS, con el propio outbox como memoria).
// ---------------------------------------------------------------------------

const MS_POR_DIA = 24 * 60 * 60 * 1000;
export const VENTANA_SIN_REPETIR_MS = 23 * 60 * 60 * 1000;

export function sinEventoReciente<T extends { contactId: string }>(
  estancadas: T[],
  conEventoReciente: Set<string>,
): T[] {
  return estancadas.filter((consulta) => !conEventoReciente.has(consulta.contactId));
}

export interface ResumenDeBarrido {
  organizaciones: number;
  emitidos: number;
  fallidas: number;
}

// Las dos opciones son SOLO PARA TESTS, igual que en el worker de
// oportunidades estancadas.
export interface OpcionesDeBarrido {
  organizationId?: string;
  ahora?: Date;
}

export function limiteDeSilencio(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * MS_POR_DIA);
}

export interface UmbralDeConsulta {
  dias: number;
  maxSeguimientos: number;
}

// El umbral de cada organización. Con la regla única del CRUD es el de su
// regla; si una carrera dejara dos, manda el menor de cada número y se avisa.
export function umbralesPorOrganizacion(
  reglas: { id: string; organizationId: string; triggerConfig: unknown }[],
): Map<string, UmbralDeConsulta> {
  const umbrales = new Map<string, UmbralDeConsulta>();
  for (const regla of reglas) {
    const config = configDeConsultaSinAvanceSchema.safeParse(regla.triggerConfig);
    if (!config.success) {
      logger.error(
        {
          automationId: regla.id,
          organizationId: regla.organizationId,
          issues: config.error.issues.map((issue) => issue.message),
        },
        "Regla de contact.inquiry_stalled con un triggerConfig inválido: se saltea",
      );
      continue;
    }
    const previo = umbrales.get(regla.organizationId);
    if (previo !== undefined) {
      logger.warn(
        { organizationId: regla.organizationId, automationId: regla.id },
        "Más de una regla activa de contact.inquiry_stalled en la organización: manda el menor umbral",
      );
    }
    umbrales.set(regla.organizationId, {
      dias: Math.min(previo?.dias ?? Infinity, config.data.daysSinceLastMessage),
      maxSeguimientos: Math.min(previo?.maxSeguimientos ?? Infinity, config.data.maxFollowUps),
    });
  }
  return umbrales;
}

export async function barrerConsultasSinAvance(
  opciones: OpcionesDeBarrido = {},
): Promise<ResumenDeBarrido> {
  const ahora = opciones.ahora ?? new Date();
  const resumen: ResumenDeBarrido = { organizaciones: 0, emitidos: 0, fallidas: 0 };

  const reglas = await findActiveAutomationsByTriggerForSweep(TRIGGER_CONTACT_INQUIRY_STALLED, {
    organizationId: opciones.organizationId,
  });

  for (const [organizationId, umbral] of umbralesPorOrganizacion(reglas)) {
    resumen.organizaciones++;
    try {
      const estancadas = await findStalledInquiries(
        organizationId,
        limiteDeSilencio(ahora, umbral.dias),
        umbral.maxSeguimientos,
      );
      if (estancadas.length === 0) {
        continue;
      }

      const emitidas = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`inquiry-stalled:${organizationId}`}::text))`;
        const conEventoReciente = await findPayloadIdsWithEventSince(
          organizationId,
          TRIGGER_CONTACT_INQUIRY_STALLED,
          "contactId",
          new Date(ahora.getTime() - VENTANA_SIN_REPETIR_MS),
          tx,
        );
        const aEmitir = sinEventoReciente(estancadas, conEventoReciente);
        for (const consulta of aEmitir) {
          await emitOutboxEvent(
            {
              organizationId,
              eventType: TRIGGER_CONTACT_INQUIRY_STALLED,
              payload: {
                contactId: consulta.contactId,
                conversationId: consulta.conversationId,
                channel: consulta.channel,
                branchId: consulta.branchId,
                ownerId: consulta.ownerId,
                lastInboundAt: consulta.lastInboundAt.toISOString(),
              },
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
        { organizationId, ...umbral, emitidos: emitidas },
        "Consultas sin avance: eventos contact.inquiry_stalled emitidos",
      );
    } catch (err) {
      resumen.fallidas++;
      logger.error(
        { err, organizationId },
        "No se pudieron emitir los eventos de consultas sin avance de esta organización; se sigue con las demás",
      );
    }
  }

  return resumen;
}

export interface OpcionesDelWorker {
  pollMs?: number;
  barrer?: () => Promise<ResumenDeBarrido>;
}

export function iniciarWorkerDeConsultasSinAvance(
  opciones: OpcionesDelWorker = {},
): () => Promise<void> {
  if (!env.INQUIRY_STALLED_WORKER_ENABLED) {
    logger.info(
      "Worker de consultas sin avance deshabilitado por INQUIRY_STALLED_WORKER_ENABLED: las reglas de contact.inquiry_stalled no se disparan",
    );
    return () => Promise.resolve();
  }

  const pollMs = opciones.pollMs ?? env.INQUIRY_STALLED_WORKER_POLL_MS;
  const barrer = opciones.barrer ?? (() => barrerConsultasSinAvance());

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
          logger.info(resumen, "Pasada de consultas sin avance");
        }
      } catch (err) {
        logger.error({ err }, "Fallo inesperado en la pasada de consultas sin avance");
      }
    })();
    await tickEnCurso;
    if (!detenido) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  };

  logger.info({ pollMs }, "Worker de consultas sin avance iniciado");
  timer = setTimeout(() => void tick(), 0);

  return async () => {
    detenido = true;
    if (timer) {
      clearTimeout(timer);
    }
    await tickEnCurso;
  };
}
