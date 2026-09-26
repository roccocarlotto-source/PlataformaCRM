import { OpportunityStatus, type Opportunity, type QrCode } from "@prisma/client";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { findOpportunityById } from "../../repositories/opportunity.repository";
import { findQrCodeById } from "../../repositories/qrCode.repository";
import {
  agendarQrFollowUp,
  type AgendarQrFollowUpData,
} from "../../repositories/qrFollowUp.repository";
import type { AccionRegistrada } from "../automationActions";
import { TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";
import { payloadDeOportunidadSchema } from "./createFollowUpActivity";

// ---------------------------------------------------------------------------
// Acción `opportunity.send_qr_followup` (ítem 159 de
// docs/frontend-cambios-pendientes.md): cuando una oportunidad pasa a ganada,
// mandarle al cliente por WhatsApp, N horas después, el link del QR de la
// sucursal (reseñas, linktree, lo que el negocio haya puesto de destino).
//
// ESTA ACCIÓN NO MANDA NADA: AGENDA. El dispatcher la corre en el instante en
// que se entrega el evento, sin noción de demora, y dentro del drenado
// síncrono del outbox — una acción que esperara horas o saliera a la red
// frenaría la cola entera. Lo único que hace es validar y dejar una fila en
// qr_follow_ups con scheduledFor = ahora + delayHours; el envío lo hace
// src/workers/qrFollowUpWorker.ts cuando vence. Es el patrón para cualquier
// acción futura con demora (docs/automations-architecture.md §5).
//
// IDEMPOTENTE POR (REGLA, OPORTUNIDAD): si el evento se reentrega antes de que
// su AutomationExecution quede en SUCCESS, el segundo agendado choca contra el
// UNIQUE de la tabla y no pasa nada — ni error ni segundo WhatsApp.
// ---------------------------------------------------------------------------

export const ACTION_SEND_QR_FOLLOWUP = "opportunity.send_qr_followup";

// 30 días. Un tope de cordura, igual que el de daysUntilDue: un "gracias por
// tu compra, dejanos tu reseña" que llega más de un mes después ya no es un
// seguimiento de esa venta.
export const MAX_DELAY_HOURS = 720;

const MS_POR_HORA = 60 * 60 * 1000;

// SIN DEFAULTS OCULTOS, mismo criterio que las otras acciones: una regla sin
// qrCodeId o sin delayHours es un 400 al crearla. El 0 es válido —"apenas se
// gana"— y es lo que permite probar la regla a mano sin esperar horas.
//
// Que el QR EXISTA y sea de la organización no se puede validar acá (el schema
// es síncrono y sin base): lo valida el handler al correr, y un QR inválido
// deja la ejecución en FAILED con un mensaje que dice que hay que editar la
// regla.
export const configDeSeguimientoQrSchema = z.object({
  qrCodeId: z.string({ required_error: "qrCodeId es requerido" }).uuid("qrCodeId debe ser un UUID"),
  delayHours: z
    .number({
      required_error: "delayHours es requerido",
      invalid_type_error: "delayHours debe ser un número entero",
    })
    .int("delayHours debe ser un número entero")
    .min(0, "delayHours no puede ser negativo")
    .max(MAX_DELAY_HOURS, `delayHours no puede superar las ${MAX_DELAY_HOURS} horas`),
});

// Exportada para probarla sin base.
export function horaDeEnvio(ahora: Date, delayHours: number): Date {
  return new Date(ahora.getTime() + delayHours * MS_POR_HORA);
}

// Inyectables para el test unitario, mismo patrón que
// DependenciasDelBorrador en draftFollowUpMessage.ts.
// Firmas con Promise plano y no `typeof` de los repositorios: esos devuelven
// el PrismaPromise del cliente, que un doble de test no puede imitar.
export interface DependenciasDelSeguimientoQr {
  leerOportunidad: (id: string, organizationId: string) => Promise<Opportunity | null>;
  leerQr: (id: string, organizationId: string) => Promise<QrCode | null>;
  // true si agendó; false si ya había uno para (regla, oportunidad).
  agendar: (data: AgendarQrFollowUpData) => Promise<boolean>;
  ahora: () => Date;
}

const dependenciasReales: DependenciasDelSeguimientoQr = {
  leerOportunidad: (id, organizationId) => findOpportunityById(id, organizationId),
  leerQr: (id, organizationId) => findQrCodeById(id, organizationId),
  agendar: (data) => agendarQrFollowUp(data),
  ahora: () => new Date(),
};

export function crearAccionSeguimientoQr(
  deps: DependenciasDelSeguimientoQr = dependenciasReales,
): AccionRegistrada {
  return {
    actionType: ACTION_SEND_QR_FOLLOWUP,
    schema: configDeSeguimientoQrSchema,
    // Solo opportunity.won. Colgada de opportunity.stale mandaría un
    // "gracias por tu compra" a una oportunidad que NO se compró — y el
    // worker la cancelaría igual al ver que no está ganada.
    triggers: [TRIGGER_OPPORTUNITY_WON],
    async handler({ organizationId, automationId, config, payload }) {
      const { qrCodeId, delayHours } = configDeSeguimientoQrSchema.parse(config);
      const { opportunityId } = payloadDeOportunidadSchema.parse(payload);

      // EL QR PRIMERO, y su ausencia SÍ es un error: es un problema de la
      // REGLA (el QR se borró después de configurarla, o el id nunca fue de
      // esta organización), y tiene que quedar a la vista en
      // AutomationExecution.error para quien la configuró. findQrCodeById ya
      // filtra por organización y por deletedAt: "de otra organización" y "no
      // existe" son el mismo mensaje, a propósito.
      const qr = await deps.leerQr(qrCodeId, organizationId);
      if (!qr) {
        throw new Error(
          `el QR ${qrCodeId} de la regla no existe o está borrado: editá la automatización y elegí otro`,
        );
      }

      // Los tres casos que terminan acá SIN agendar y SIN error: no hay nada
      // que reintentar, igual que en agent.draft_follow_up. Entre la emisión y
      // el despacho pueden haber pasado cosas (un evento que se reintenta puede
      // llegar horas después).
      const oportunidad = await deps.leerOportunidad(opportunityId, organizationId);
      if (!oportunidad) {
        logger.info(
          { organizationId, automationId, opportunityId },
          "Seguimiento con QR: la oportunidad ya no existe o está borrada; no se agenda nada",
        );
        return;
      }
      if (oportunidad.status !== OpportunityStatus.WON) {
        logger.info(
          { organizationId, automationId, opportunityId, status: oportunidad.status },
          "Seguimiento con QR: la oportunidad ya no está ganada; no se agenda nada",
        );
        return;
      }
      // Una oportunidad puede ser de una empresa sin contacto (el CHECK de la
      // tabla exige uno de los dos): no hay a quién escribirle. Warn y no info:
      // es una regla que se va a disparar sin efecto cada vez que se gane una
      // venta así, y quien la configuró lo tiene que poder ver en el log.
      if (!oportunidad.contactId) {
        logger.warn(
          { organizationId, automationId, opportunityId },
          "Seguimiento con QR: la oportunidad no tiene contacto; no hay a quién mandarle el WhatsApp",
        );
        return;
      }

      const scheduledFor = horaDeEnvio(deps.ahora(), delayHours);
      const agendado = await deps.agendar({
        organizationId,
        automationId,
        opportunityId,
        contactId: oportunidad.contactId,
        qrCodeId: qr.id,
        scheduledFor,
      });

      logger.info(
        { organizationId, automationId, opportunityId, qrCodeId: qr.id, scheduledFor, agendado },
        agendado
          ? "Seguimiento con QR agendado"
          : "Seguimiento con QR ya estaba agendado para esta regla y oportunidad (reentrega del evento): no se duplica",
      );
    },
  };
}

export const accionSeguimientoQr = crearAccionSeguimientoQr();
