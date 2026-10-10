import { z } from "zod";
import { logger } from "../../lib/logger";
import type { AccionRegistrada } from "../../services/automationActions";
import {
  LARGO_MAXIMO_DEL_CUERPO,
  VARIABLES_DE_RECORDATORIO,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import { ACTION_BOOKING_SEND_REMINDER, TRIGGER_BOOKING_REMINDER_DUE } from "./config";

// ---------------------------------------------------------------------------
// La acción "Mandar el recordatorio por WhatsApp" (booking.send_reminder,
// docs/rubros.md §6.3 y §7.3, R13). Solo clínicas (módulo
// recordatorios_de_turno) y solo con su trigger.
//
// La regla guarda el texto de la plantilla UTILITY (con los botones Confirmo /
// Necesito cancelar, que agrega el alta en Meta) y si el recordatorio está
// activo. El envío NO pasa por el despacho del motor: lo agenda el consumidor
// de los eventos del turno y lo manda recordatorioWorker.ts. Por eso el
// handler no hace nada (nadie emite booking.reminder_due).
// ---------------------------------------------------------------------------

export const configDelRecordatorioSchema = z
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
      variables: VARIABLES_DE_RECORDATORIO,
    });
    if (problema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["messageText"], message: problema });
    }
  });

export const accionRecordatorio: AccionRegistrada = {
  actionType: ACTION_BOOKING_SEND_REMINDER,
  schema: configDelRecordatorioSchema,
  triggers: [TRIGGER_BOOKING_REMINDER_DUE],
  modulo: "recordatorios_de_turno",
  handler: ({ organizationId, automationId }) => {
    logger.debug(
      { organizationId, automationId },
      "booking.send_reminder no se despacha: el recordatorio lo agenda el consumidor del turno",
    );
    return Promise.resolve();
  },
};
