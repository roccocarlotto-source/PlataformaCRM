import { z } from "zod";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { findQrCodeById } from "../../repositories/qrCode.repository";
import type { AccionRegistrada } from "../../services/automationActions";
import {
  camposDeLaDemora,
  demoraEnMinutos,
  validarDemora,
} from "../../services/automationActions/demoraDelEnvio";
import {
  camposDelMensajeDeWhatsapp,
  validarMensajeDeWhatsapp,
} from "../../services/automationActions/mensajeDeWhatsapp";
import {
  LARGO_MAXIMO_DEL_CUERPO,
  VARIABLES_DE_CONTROL,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import { agendarMensajeDelTurno } from "../recordatorios/repository";
import {
  ACTION_BOOKING_SCHEDULE_CONTROL,
  ACTION_BOOKING_SEND_QR_REVIEW,
  DEMORA_MINIMA_DEL_QR_MIN,
  TRIGGER_BOOKING_COMPLETED,
  cuandoSaleElControl,
  cuandoSaleElQr,
} from "./config";

// ---------------------------------------------------------------------------
// Las acciones de "Cuando se atiende un turno" (booking.completed, docs/rubros.md
// §7, R14). Solo clínicas (módulo post_turno). Las despacha el motor con el
// evento que emite R10 al marcar Atendido (o al cerrar solo a las 3 h). NO
// mandan nada: agendan una fila en booking_messages (REVIEW_QR o CONTROL) que
// manda el worker de R13.
//
// IDEMPOTENTES POR TURNO: el UNIQUE parcial de booking_messages (turno, tipo,
// horario) hace que la reentrega del evento, o una corrección a Atendido
// después de un No vino, no agende otro si ya hay uno vigente. Lo que ya salió
// nunca se reenvía: un SENT sigue siendo vigente.
// ---------------------------------------------------------------------------

export const payloadDelTurnoAtendidoSchema = z.object({
  bookingId: z.string().uuid(),
  automatico: z.boolean().optional(),
});

/** La misma configuración que el QR de una automotora (qrCodeId, demora,
 *  formato y texto), con la demora mínima de 3 h de §7.1. */
export const configDelQrDeResenaSchema = z
  .object({
    qrCodeId: z
      .string({ required_error: "qrCodeId es requerido" })
      .uuid("qrCodeId debe ser un UUID"),
    ...camposDeLaDemora,
    ...camposDelMensajeDeWhatsapp,
  })
  .superRefine(validarMensajeDeWhatsapp)
  .superRefine(validarDemora)
  .transform(demoraEnMinutos)
  .superRefine((config, ctx) => {
    if (config.delayMinutes < DEMORA_MINIMA_DEL_QR_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delayMinutes"],
        message:
          "En una clínica la demora del QR es de al menos 3 horas (para corregir un No vino)",
      });
    }
  });

export const configDelControlSchema = z
  .object({
    messageText: z
      .string({
        required_error: "messageText es requerido",
        invalid_type_error: "messageText debe ser un texto",
      })
      .trim()
      .min(1, "messageText es requerido")
      .max(LARGO_MAXIMO_DEL_CUERPO * 2, "messageText es demasiado largo"),
  })
  .superRefine((config, ctx) => {
    const problema = validarTextoDePlantilla(config.messageText, {
      variables: VARIABLES_DE_CONTROL,
    });
    if (problema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["messageText"], message: problema });
    }
  });

/** El turno atendido, releído (el evento puede llegar tarde o reentregarse). */
function turnoAtendido(organizationId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      completedAt: true,
      contactId: true,
      serviceType: { select: { followUpAfterDays: true } },
    },
  });
}

export const accionQrDeResena: AccionRegistrada = {
  actionType: ACTION_BOOKING_SEND_QR_REVIEW,
  schema: configDelQrDeResenaSchema,
  triggers: [TRIGGER_BOOKING_COMPLETED],
  modulo: "post_turno",
  async handler({ organizationId, automationId, config, payload }) {
    const { qrCodeId, delayMinutes } = configDelQrDeResenaSchema.parse(config);
    const { bookingId, automatico } = payloadDelTurnoAtendidoSchema.parse(payload);
    // El QR de la regla tiene que existir: si no, es un problema de la regla y
    // queda en AutomationExecution.error (mismo criterio que la de automotoras).
    const qr = await findQrCodeById(qrCodeId, organizationId);
    if (!qr) {
      throw new Error(
        `el QR ${qrCodeId} de la regla no existe o está borrado: editá la automatización y elegí otro`,
      );
    }
    const turno = await turnoAtendido(organizationId, bookingId);
    if (!turno || turno.status !== "COMPLETED" || !turno.completedAt) {
      logger.info({ organizationId, bookingId }, "QR de reseña: el turno ya no está atendido");
      return;
    }
    const agendado = await agendarMensajeDelTurno({
      organizationId,
      bookingId,
      contactId: turno.contactId,
      automationId,
      kind: "REVIEW_QR",
      bookingStartsAt: turno.startsAt,
      scheduledFor: cuandoSaleElQr(turno.completedAt, delayMinutes, automatico === true),
    });
    logger.info(
      { organizationId, bookingId, agendado },
      agendado ? "QR de reseña agendado" : "QR de reseña ya agendado o enviado: no se duplica",
    );
  },
};

export const accionControl: AccionRegistrada = {
  actionType: ACTION_BOOKING_SCHEDULE_CONTROL,
  schema: configDelControlSchema,
  triggers: [TRIGGER_BOOKING_COMPLETED],
  modulo: "post_turno",
  async handler({ organizationId, automationId, payload }) {
    const { bookingId } = payloadDelTurnoAtendidoSchema.parse(payload);
    const turno = await turnoAtendido(organizationId, bookingId);
    if (!turno || turno.status !== "COMPLETED" || !turno.completedAt) return;
    const dias = turno.serviceType.followUpAfterDays;
    if (dias === null) return; // La prestación no tiene control.
    const agendado = await agendarMensajeDelTurno({
      organizationId,
      bookingId,
      contactId: turno.contactId,
      automationId,
      kind: "CONTROL",
      bookingStartsAt: turno.startsAt,
      scheduledFor: cuandoSaleElControl(turno.completedAt, dias),
    });
    logger.info(
      { organizationId, bookingId, agendado },
      agendado ? "Control agendado" : "Control ya agendado o enviado: no se duplica",
    );
  },
};
