import { ACTION_SEND_QR_FOLLOWUP, TRIGGER_OPPORTUNITY_WON } from "../automation/catalog";

// Las acciones de automatización que mandan un WhatsApp con plantilla (ítem
// 181): cada regla que usa una de estas tiene SU plantilla. Espejo a mano de
// ACCIONES_CON_PLANTILLA en src/services/whatsappTemplate.service.ts; una
// acción nueva de este tipo se suma en los dos lados.
//
// Vive acá y no en automation/catalog.ts a propósito: el catálogo alimenta el
// formulario de alta de automatizaciones, y sumarle el cupón lo ofrecería ahí
// — un gap abierto del ítem 177, fuera de este alcance.

export const ACTION_SEND_DISCOUNT_VOUCHER = "opportunity.send_discount_voucher";

// Hoy las dos cuelgan de "oportunidad ganada": el listado le pide al backend
// solo esas reglas (GET /api/automations?triggerType=…) y filtra por acción.
export const TRIGGER_DE_LAS_ACCIONES_CON_PLANTILLA = TRIGGER_OPPORTUNITY_WON;

export interface AccionConPlantilla {
  // Cómo se nombra la acción en la pantalla.
  label: string;
  // Qué es el {link} para esta acción, para el texto de ayuda.
  queEsElLink: string;
  // Con qué arranca el formulario de una plantilla nueva. El nombre es único
  // en toda la plataforma (WABA compartido): es un punto de partida, el
  // negocio lo cambia si ya está en uso.
  nombreInicial: string;
  textoInicial: string;
}

export const ACCIONES_CON_PLANTILLA: Record<string, AccionConPlantilla> = {
  [ACTION_SEND_QR_FOLLOWUP]: {
    label: "Enviar QR por WhatsApp",
    queEsElLink: "el link del QR",
    nombreInicial: "seguimiento_postventa",
    textoInicial:
      "Hola {nombre}, gracias por tu compra. Nos ayudaría mucho conocer tu opinión sobre la atención que recibiste. Podés dejarla en este enlace: {link} ¡Muchas gracias!",
  },
  [ACTION_SEND_DISCOUNT_VOUCHER]: {
    label: "Enviar cupón de descuento por WhatsApp",
    queEsElLink: "el link del cupón",
    nombreInicial: "cupon_descuento",
    textoInicial:
      "Hola {nombre}, gracias por tu compra. Te regalamos un cupón de descuento para tu próxima visita. Lo encontrás en este enlace: {link} ¡Te esperamos!",
  },
};

export function accionConPlantilla(actionType: string): AccionConPlantilla | undefined {
  return ACCIONES_CON_PLANTILLA[actionType];
}
