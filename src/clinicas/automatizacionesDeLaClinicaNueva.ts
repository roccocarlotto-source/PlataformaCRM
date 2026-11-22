import type { Prisma } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { ACTION_CREATE_FOLLOW_UP } from "../services/automationActions/createFollowUpActivity";
import { ACTION_INQUIRY_FOLLOW_UP } from "../services/automationActions/inquiryFollowUp";
import {
  DIAS_SIN_RESPUESTA_POR_DEFECTO,
  MAX_SEGUIMIENTOS_POR_DEFECTO,
  TRIGGER_CONTACT_INQUIRY_STALLED,
} from "../services/automationTriggers";
import {
  ACTION_BOOKING_SCHEDULE_CONTROL,
  ACTION_BOOKING_SEND_QR_REVIEW,
  DEMORA_MINIMA_DEL_QR_MIN,
  TEXTO_POR_DEFECTO_DEL_CONTROL,
  TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  TRIGGER_BOOKING_COMPLETED,
} from "./postTurno/config";
import {
  ACTION_BOOKING_SEND_REMINDER,
  TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
  TRIGGER_BOOKING_REMINDER_DUE,
} from "./recordatorios/config";
import { TEXTO_POR_DEFECTO_DE_CLINICA } from "./seguimientoDeConsultas";

// ---------------------------------------------------------------------------
// Las automatizaciones con las que nace una clínica (QA de la primera clínica,
// 2026-11-21): las cinco del catálogo de clínica (docs/rubros.md §7.3), todas
// APAGADAS, para que la dueña no tenga que descubrirlas ni armarlas a mano. Se
// prenden desde Automatizaciones cuando la clínica tenga su número de WhatsApp
// (las que mandan WhatsApp no se activan sin él, automationWhatsapp.service.ts).
//
// - Se crean en la transacción del alta (organizationAdmin.service.ts), con
//   la escritura directa y sin pasar por createAutomation: la organización
//   todavía no está commiteada, así que createAutomation no la vería. Por eso
//   cada config está escrita YA normalizada (como la guardaría el CRUD), y un
//   test la pasa por el schema de su acción y de su trigger.
// - Nada va a Meta: una regla inactiva de una clínica sin número no sincroniza
//   plantilla. Al prenderla con el número conectado, la plantilla se manda a
//   aprobación sola (actualizarReglaConMensaje).
// - El QR de reseña nace SIN QR (la clínica todavía no tiene el link de
//   reseñas): el schema lo admite apagada y exige elegirlo para prenderla
//   (faltaParaActivar en postTurno/acciones.ts).
// - Solo en el alta de una clínica. Ni la Clínica Demo (crea sus propias
//   reglas, con su QR) ni el cambio de rubro. Una automotora nunca.
// ---------------------------------------------------------------------------

/** La tarea después del turno: el asunto y a cuántos días vence. */
export const TAREA_DESPUES_DEL_TURNO = {
  subject: "Llamar para ver cómo le fue",
  daysUntilDue: 2,
} as const;

export interface ReglaDeLaClinicaNueva {
  name: string;
  triggerType: string;
  actionType: string;
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
}

export const AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA: readonly ReglaDeLaClinicaNueva[] = [
  {
    name: "Recordatorio antes del turno",
    triggerType: TRIGGER_BOOKING_REMINDER_DUE,
    actionType: ACTION_BOOKING_SEND_REMINDER,
    triggerConfig: {},
    actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO },
  },
  {
    name: "Pedir una reseña con un QR",
    triggerType: TRIGGER_BOOKING_COMPLETED,
    actionType: ACTION_BOOKING_SEND_QR_REVIEW,
    triggerConfig: {},
    actionConfig: {
      delayMinutes: DEMORA_MINIMA_DEL_QR_MIN,
      whatsappFormat: "LINK",
      messageText: TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
    },
  },
  {
    name: "Recordar el control",
    triggerType: TRIGGER_BOOKING_COMPLETED,
    actionType: ACTION_BOOKING_SCHEDULE_CONTROL,
    triggerConfig: {},
    actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_CONTROL },
  },
  {
    name: "Tarea después del turno",
    triggerType: TRIGGER_BOOKING_COMPLETED,
    actionType: ACTION_CREATE_FOLLOW_UP,
    triggerConfig: {},
    actionConfig: { ...TAREA_DESPUES_DEL_TURNO },
  },
  {
    name: "Retomar la consulta",
    triggerType: TRIGGER_CONTACT_INQUIRY_STALLED,
    actionType: ACTION_INQUIRY_FOLLOW_UP,
    triggerConfig: {
      daysSinceLastMessage: DIAS_SIN_RESPUESTA_POR_DEFECTO,
      maxFollowUps: MAX_SEGUIMIENTOS_POR_DEFECTO,
    },
    actionConfig: { messageText: TEXTO_POR_DEFECTO_DE_CLINICA },
  },
];

/** Crea las cinco reglas apagadas de una clínica recién dada de alta, en la
 *  transacción del alta. */
export async function crearAutomatizacionesDeLaClinicaNueva(organizationId: string, db: Db) {
  return db.automation.createMany({
    data: AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA.map((regla) => ({
      organizationId,
      name: regla.name,
      triggerType: regla.triggerType,
      actionType: regla.actionType,
      triggerConfig: regla.triggerConfig as Prisma.InputJsonValue,
      actionConfig: regla.actionConfig as Prisma.InputJsonValue,
      isActive: false,
    })),
  });
}
