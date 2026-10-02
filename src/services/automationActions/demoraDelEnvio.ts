import { z } from "zod";

// ---------------------------------------------------------------------------
// La demora de las reglas que AGENDAN un WhatsApp (el QR de reseñas y el
// cupón de descuento), dentro de su actionConfig: cuánto después de ganada la
// oportunidad sale el envío.
//
// - delayMinutes: la clave actual, en minutos, de 0 —"apenas se gana"— a 30
//   días. Minutos y no horas para poder programar envíos de menos de una hora.
// - delayHours: la clave LEGADA. Las reglas guardadas antes de delayMinutes la
//   tienen y siguen funcionando sin tocarlas: al leerlas (al despachar o al
//   revalidar en un PUT) se convierten a minutos. No hace falta migrar datos:
//   la config es JSON y cada regla se reescribe sola con delayMinutes la
//   próxima vez que se guarda, porque lo que se guarda es la salida del schema
//   (validarAccion en automation.service.ts).
//
// Exactamente una de las dos: ninguna es un 400 (sin defaults ocultos, mismo
// criterio que el resto de las acciones) y las dos juntas también, porque no
// hay forma de saber cuál quiso decir quien las mandó.
// ---------------------------------------------------------------------------

// 30 días. Un tope de cordura, igual que el de daysUntilDue: un "gracias por
// tu compra, dejanos tu reseña" que llega más de un mes después ya no es un
// seguimiento de esa venta.
export const MAX_DELAY_MINUTES = 30 * 24 * 60;
// El mismo tope expresado en la unidad legada.
export const MAX_DELAY_HOURS = MAX_DELAY_MINUTES / 60;

const MS_POR_MINUTO = 60 * 1000;

export const camposDeLaDemora = {
  delayMinutes: z
    .number({ invalid_type_error: "delayMinutes debe ser un número entero" })
    .int("delayMinutes debe ser un número entero")
    .min(0, "delayMinutes no puede ser negativo")
    .max(MAX_DELAY_MINUTES, `delayMinutes no puede superar los ${MAX_DELAY_MINUTES} minutos`)
    .optional(),
  delayHours: z
    .number({ invalid_type_error: "delayHours debe ser un número entero" })
    .int("delayHours debe ser un número entero")
    .min(0, "delayHours no puede ser negativo")
    .max(MAX_DELAY_HOURS, `delayHours no puede superar las ${MAX_DELAY_HOURS} horas`)
    .optional(),
};

interface ConDemora {
  delayMinutes?: number;
  delayHours?: number;
}

// El refine que se cuelga del schema de cada acción.
export function validarDemora(config: ConDemora, ctx: z.RefinementCtx): void {
  if (config.delayMinutes === undefined && config.delayHours === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["delayMinutes"],
      message: "delayMinutes es requerido",
    });
  }
  if (config.delayMinutes !== undefined && config.delayHours !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["delayHours"],
      message: "mandá delayMinutes o delayHours, no los dos",
    });
  }
}

// El transform final: la salida del schema siempre trae delayMinutes y nunca
// delayHours. Solo corre si el config ya es válido (zod no transforma un
// resultado con issues), así que una de las dos está.
export function demoraEnMinutos<T extends ConDemora>(
  config: T,
): Omit<T, "delayHours" | "delayMinutes"> & { delayMinutes: number } {
  const { delayHours, delayMinutes, ...resto } = config;
  return { ...resto, delayMinutes: delayMinutes ?? (delayHours ?? 0) * 60 };
}

// Exportada para probarla sin base.
export function horaDeEnvio(ahora: Date, delayMinutes: number): Date {
  return new Date(ahora.getTime() + delayMinutes * MS_POR_MINUTO);
}
