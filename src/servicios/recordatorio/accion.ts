import { z } from "zod";
import { logger } from "../../lib/logger";
import type { AccionRegistrada } from "../../services/automationActions";
import {
  LARGO_MAXIMO_DEL_CUERPO,
  VARIABLES_DE_PROXIMO_SERVICE,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import { ACTION_SEND_NEXT_SERVICE_REMINDER, TRIGGER_NEXT_SERVICE_DUE } from "./config";
import { encolarRecordatorio } from "./repository";

// ---------------------------------------------------------------------------
// La acción "Mandar recordatorio por WhatsApp" (service.send_next_service_reminder,
// docs/servicios.md §6.3, S7). Solo con el módulo Servicios y solo con su
// trigger. Encola el mensaje del aviso en service_messages; lo manda (y
// revalida antes) src/servicios/recordatorio/worker.ts.
//
// La regla guarda el texto de su plantilla MARKETING (§6.4) y la casilla "Si no
// tiene WhatsApp, crear tarea para llamar" (D8), activada por defecto.
// ---------------------------------------------------------------------------

export const configDelRecordatorioDelServiceSchema = z
  .object({
    messageText: z
      .string({
        required_error: "messageText es requerido",
        invalid_type_error: "messageText debe ser un texto",
      })
      .trim()
      .min(1, "messageText es requerido")
      .max(LARGO_MAXIMO_DEL_CUERPO * 2, "messageText es demasiado largo"),
    tareaSiNoTieneWhatsapp: z
      .boolean({ invalid_type_error: "tareaSiNoTieneWhatsapp debe ser verdadero o falso" })
      .default(true),
  })
  .superRefine((config, ctx) => {
    const problema = validarTextoDePlantilla(config.messageText, {
      variables: VARIABLES_DE_PROXIMO_SERVICE,
    });
    if (problema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["messageText"], message: problema });
    }
  });

export type ConfigDelRecordatorioDelService = z.infer<typeof configDelRecordatorioDelServiceSchema>;

/** El payload del evento service.next_service_due (barrido.ts). */
export const payloadDelAvisoSchema = z.object({
  automationId: z.string().uuid(),
  noticeId: z.string().uuid(),
  customerVehicleId: z.string().uuid(),
  contactId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  nextServiceDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const accionRecordatorioDelService: AccionRegistrada = {
  actionType: ACTION_SEND_NEXT_SERVICE_REMINDER,
  schema: configDelRecordatorioDelServiceSchema,
  triggers: [TRIGGER_NEXT_SERVICE_DUE],
  modulo: "servicios",
  async handler({ organizationId, automationId, payload }) {
    const aviso = payloadDelAvisoSchema.parse(payload);
    const resultado = await encolarRecordatorio({
      organizationId,
      automationId,
      noticeId: aviso.noticeId,
      customerVehicleId: aviso.customerVehicleId,
      contactId: aviso.contactId,
      branchId: aviso.branchId,
      dueKey: new Date(`${aviso.nextServiceDueOn}T00:00:00.000Z`),
      ahora: new Date(),
    });
    if (resultado === "YA_EXISTIA") {
      logger.info(
        { organizationId, noticeId: aviso.noticeId },
        "Próximo service: el aviso ya tenía su mensaje en la cola",
      );
    }
  },
};
