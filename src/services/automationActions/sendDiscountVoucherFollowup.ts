import { OpportunityStatus, type Branch, type Opportunity } from "@prisma/client";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { findBranchById } from "../../repositories/branch.repository";
import {
  agendarDiscountVoucherFollowUp,
  type AgendarDiscountVoucherFollowUpData,
} from "../../repositories/discountVoucherFollowUp.repository";
import { findOpportunityById } from "../../repositories/opportunity.repository";
import type { AccionRegistrada } from "../automationActions";
import { TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";
import { MAX_LABEL_LENGTH } from "../discountVoucher.service";
import { payloadDeOportunidadSchema } from "./createFollowUpActivity";
import { camposDelMensajeDeWhatsapp, validarMensajeDeWhatsapp } from "./mensajeDeWhatsapp";
import { MAX_DELAY_HOURS, horaDeEnvio } from "./sendQrFollowup";

// ---------------------------------------------------------------------------
// Acción `opportunity.send_discount_voucher` (ítem 177 de
// docs/frontend-cambios-pendientes.md): cuando una oportunidad pasa a ganada,
// mandarle al cliente por WhatsApp, N horas después, un cupón de descuento de
// un solo uso (ítem 176) con su link.
//
// EL MISMO MOLDE QUE opportunity.send_qr_followup (sendQrFollowup.ts), y por
// los mismos motivos: ESTA ACCIÓN NO MANDA NADA NI EMITE EL CUPÓN, AGENDA.
// Deja una fila en discount_voucher_follow_ups y el worker
// (src/workers/discountVoucherFollowUpWorker.ts) emite el cupón y lo manda
// cuando vence. Emitirlo acá dejaría un cupón vivo para una venta que, cuando
// le toque salir, pudo haber dejado de estar ganada.
//
// IDEMPOTENTE POR (REGLA, OPORTUNIDAD), igual que la del QR: la reentrega del
// evento choca contra el UNIQUE de la tabla y no agenda nada.
// ---------------------------------------------------------------------------

export const ACTION_SEND_DISCOUNT_VOUCHER = "opportunity.send_discount_voucher";

// Un año. Tope de cordura, no de negocio: un cupón "para siempre" no se
// configura por error con 36500 días.
export const MAX_EXPIRES_IN_DAYS = 365;

// SIN DEFAULTS OCULTOS, mismo criterio que la del QR: una regla sin alguno de
// los cuatro campos es un 400 al crearla.
//
// branchId es la sucursal de cuyo número de WhatsApp sale el mensaje. En la
// regla del QR la pone el QR elegido (cada QR es de una sucursal); un cupón no
// es de ninguna, así que se elige acá. Que exista y sea de la organización lo
// valida el handler, igual que el qrCodeId allá.
export const configDeCuponSchema = z
  .object({
    label: z
      .string({
        required_error: "label es requerido",
        invalid_type_error: "label debe ser un texto",
      })
      .trim()
      .min(1, "label es requerido")
      .max(MAX_LABEL_LENGTH, `label no puede superar los ${MAX_LABEL_LENGTH} caracteres`),
    delayHours: z
      .number({
        required_error: "delayHours es requerido",
        invalid_type_error: "delayHours debe ser un número entero",
      })
      .int("delayHours debe ser un número entero")
      .min(0, "delayHours no puede ser negativo")
      .max(MAX_DELAY_HOURS, `delayHours no puede superar las ${MAX_DELAY_HOURS} horas`),
    expiresInDays: z
      .number({
        required_error: "expiresInDays es requerido",
        invalid_type_error: "expiresInDays debe ser un número entero",
      })
      .int("expiresInDays debe ser un número entero")
      .min(1, "expiresInDays tiene que ser al menos 1")
      .max(MAX_EXPIRES_IN_DAYS, `expiresInDays no puede superar los ${MAX_EXPIRES_IN_DAYS} días`),
    branchId: z
      .string({ required_error: "branchId es requerido" })
      .uuid("branchId debe ser un UUID"),
    // Formato y texto del WhatsApp (mensajeDeWhatsapp.ts). Para el cupón, la
    // imagen es el QR de ESE cupón: el que se escanea en "Canjear cupón".
    ...camposDelMensajeDeWhatsapp,
  })
  .superRefine(validarMensajeDeWhatsapp);

// Inyectables para el test unitario, mismo patrón que
// DependenciasDelSeguimientoQr.
export interface DependenciasDelCupon {
  leerOportunidad: (id: string, organizationId: string) => Promise<Opportunity | null>;
  leerSucursal: (id: string, organizationId: string) => Promise<Branch | null>;
  // true si agendó; false si ya había uno para (regla, oportunidad).
  agendar: (data: AgendarDiscountVoucherFollowUpData) => Promise<boolean>;
  ahora: () => Date;
}

const dependenciasReales: DependenciasDelCupon = {
  leerOportunidad: (id, organizationId) => findOpportunityById(id, organizationId),
  leerSucursal: (id, organizationId) => findBranchById(id, organizationId),
  agendar: (data) => agendarDiscountVoucherFollowUp(data),
  ahora: () => new Date(),
};

export function crearAccionCupon(
  deps: DependenciasDelCupon = dependenciasReales,
): AccionRegistrada {
  return {
    actionType: ACTION_SEND_DISCOUNT_VOUCHER,
    schema: configDeCuponSchema,
    // Solo opportunity.won, mismo motivo que la del QR: un cupón de "gracias
    // por tu compra" no tiene sentido en una oportunidad que no se compró.
    triggers: [TRIGGER_OPPORTUNITY_WON],
    async handler({ organizationId, automationId, config, payload }) {
      const { label, delayHours, expiresInDays, branchId } = configDeCuponSchema.parse(config);
      const { opportunityId } = payloadDeOportunidadSchema.parse(payload);

      // LA SUCURSAL PRIMERO, y su ausencia SÍ es un error: es un problema de
      // la REGLA, igual que el QR borrado en la del QR, y tiene que quedar a
      // la vista en AutomationExecution.error. findBranchById filtra por
      // organización y por deletedAt: "de otra organización" y "no existe"
      // son el mismo mensaje, a propósito.
      const sucursal = await deps.leerSucursal(branchId, organizationId);
      if (!sucursal) {
        throw new Error(
          `la sucursal ${branchId} de la regla no existe o está borrada: editá la automatización y elegí otra`,
        );
      }

      // Los tres casos que terminan SIN agendar y SIN error, los mismos que
      // en la del QR.
      const oportunidad = await deps.leerOportunidad(opportunityId, organizationId);
      if (!oportunidad) {
        logger.info(
          { organizationId, automationId, opportunityId },
          "Cupón de descuento: la oportunidad ya no existe o está borrada; no se agenda nada",
        );
        return;
      }
      if (oportunidad.status !== OpportunityStatus.WON) {
        logger.info(
          { organizationId, automationId, opportunityId, status: oportunidad.status },
          "Cupón de descuento: la oportunidad ya no está ganada; no se agenda nada",
        );
        return;
      }
      if (!oportunidad.contactId) {
        logger.warn(
          { organizationId, automationId, opportunityId },
          "Cupón de descuento: la oportunidad no tiene contacto; no hay a quién mandarle el WhatsApp",
        );
        return;
      }

      const scheduledFor = horaDeEnvio(deps.ahora(), delayHours);
      const agendado = await deps.agendar({
        organizationId,
        automationId,
        opportunityId,
        contactId: oportunidad.contactId,
        branchId: sucursal.id,
        label,
        expiresInDays,
        scheduledFor,
      });

      logger.info(
        { organizationId, automationId, opportunityId, scheduledFor, agendado },
        agendado
          ? "Cupón de descuento agendado"
          : "Cupón de descuento ya estaba agendado para esta regla y oportunidad (reentrega del evento): no se duplica",
      );
    },
  };
}

export const accionCupon = crearAccionCupon();
