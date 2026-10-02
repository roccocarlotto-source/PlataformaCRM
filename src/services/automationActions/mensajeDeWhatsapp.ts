import { z } from "zod";
import {
  FORMATO_POR_DEFECTO,
  FORMATOS_DE_MENSAJE,
  LARGO_MAXIMO_DEL_CUERPO,
  formatoLlevaLink,
  validarTextoDePlantilla,
  type FormatoDeMensaje,
} from "../../utils/whatsappTemplateText";

// ---------------------------------------------------------------------------
// Los dos campos del mensaje de WhatsApp que comparten las reglas que mandan
// uno (el QR de reseñas y el cupón de descuento), dentro de su actionConfig:
//
// - whatsappFormat: "LINK" | "IMAGE" | "LINK_AND_IMAGE". Opcional: una regla
//   guardada antes de que existiera la elección es "solo link", que es lo que
//   mandaba, y sigue así sin pedir otra aprobación.
// - messageText: el texto con {nombre} y {link}. Opcional por la misma razón:
//   sin él vale el de la plantilla que la regla ya tiene en Meta.
//
// La plantilla de Meta NO se configura aparte: se deriva de estos dos campos
// al guardar la regla (automationWhatsapp.service.ts). Lo que sí se valida
// acá, sin red ni base, es que el texto sirva para el formato elegido.
// ---------------------------------------------------------------------------

export const camposDelMensajeDeWhatsapp = {
  whatsappFormat: z
    .enum(FORMATOS_DE_MENSAJE, {
      errorMap: () => ({ message: `whatsappFormat debe ser ${FORMATOS_DE_MENSAJE.join(", ")}` }),
    })
    .optional(),
  messageText: z
    .string({ invalid_type_error: "messageText debe ser un texto" })
    .trim()
    // Tope holgado del texto tal cual se escribe; el real (sobre lo que viaja
    // a Meta) lo mide validarTextoDePlantilla.
    .max(LARGO_MAXIMO_DEL_CUERPO * 2, "messageText es demasiado largo")
    .optional(),
};

// El refine que se cuelga del schema de cada acción: el texto, si viene, tiene
// que servir para el formato (con o sin {link}).
export function validarMensajeDeWhatsapp(
  config: { whatsappFormat?: FormatoDeMensaje; messageText?: string },
  ctx: z.RefinementCtx,
): void {
  if (config.messageText === undefined) return;
  const formato = config.whatsappFormat ?? FORMATO_POR_DEFECTO;
  const problema = validarTextoDePlantilla(config.messageText, {
    conLink: formatoLlevaLink(formato),
  });
  if (problema) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["messageText"], message: problema });
  }
}

export interface MensajeDeLaRegla {
  formato: FormatoDeMensaje;
  texto: string | null;
}

// Lo que la regla pide, leído de un actionConfig ya guardado (Json).
export function mensajeDeLaRegla(actionConfig: unknown): MensajeDeLaRegla {
  const config = (actionConfig ?? {}) as { whatsappFormat?: unknown; messageText?: unknown };
  const formato = (FORMATOS_DE_MENSAJE as readonly unknown[]).includes(config.whatsappFormat)
    ? (config.whatsappFormat as FormatoDeMensaje)
    : FORMATO_POR_DEFECTO;
  const texto =
    typeof config.messageText === "string" && config.messageText.trim() !== ""
      ? config.messageText.trim()
      : null;
  return { formato, texto };
}
