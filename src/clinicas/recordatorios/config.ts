import { DateTime } from "luxon";

// ---------------------------------------------------------------------------
// El recordatorio de turno de una clínica (docs/rubros.md §6, R13): las
// constantes, los textos fijos y las funciones puras. Nada de esto corre en una
// automotora: no tiene la regla, ni filas en booking_messages.
// ---------------------------------------------------------------------------

export const TRIGGER_BOOKING_REMINDER_DUE = "booking.reminder_due";
export const ACTION_BOOKING_SEND_REMINDER = "booking.send_reminder";

/** El texto con el que arranca una regla nueva (espejo en
 *  frontend/src/features/automation/catalog.ts). Sin la prestación: es un dato
 *  de salud en la pantalla del teléfono (§6.3). */
export const TEXTO_POR_DEFECTO_DEL_RECORDATORIO =
  "Hola {nombre}, te recordamos tu turno en {lugar} el {dia} a las {hora} con {profesional}. ¿Nos confirmás si venís?";

/** Los dos botones de respuesta rápida, en este orden (§6.3). El texto es lo
 *  que ve el paciente; el payload, lo que vuelve en el webhook. */
export const BOTONES_DEL_RECORDATORIO = [
  { texto: "Confirmo", payload: "CONFIRMAR" },
  { texto: "Necesito cancelar", payload: "CANCELAR" },
] as const;

export type RespuestaDelBoton = (typeof BOTONES_DEL_RECORDATORIO)[number]["payload"];

export function esRespuestaDelBoton(valor: string | null | undefined): valor is RespuestaDelBoton {
  return BOTONES_DEL_RECORDATORIO.some((b) => b.payload === valor);
}

// Las respuestas fijas, sin modelo (§6.4). Van dentro de la ventana de 24 h
// que abrió la respuesta del paciente.
export const TEXTO_CONFIRMADO = "¡Gracias! Te esperamos.";
export const TEXTO_CANCELADO =
  "Listo, cancelamos tu turno. Si querés otro día u horario, escribinos por acá y te ayudamos a reprogramarlo.";
export const TEXTO_CANCELAR_FUERA_DE_PLAZO =
  "Gracias por avisar. Como falta poco para el turno, una persona del equipo te va a escribir para resolverlo.";
export const TEXTO_TURNO_YA_NO_VIGENTE =
  "Gracias por responder. Ese turno ya no está vigente: si necesitás algo, escribinos por acá.";

// Los asuntos de las notas y tareas. Sin datos de salud: el nombre del
// paciente, el día y la hora.
export const PREFIJO_NOTA_CONFIRMADO = "Turno confirmado por el paciente: ";
export const PREFIJO_TAREA_SIN_RESPUESTA = "Confirmar por teléfono el turno de ";
export const PREFIJO_TAREA_CANCELO_POR_RECORDATORIO = "Turno cancelado por el paciente: ";
export const PREFIJO_TAREA_CANCELAR_FUERA_DE_PLAZO = "Quiere cancelar su turno: ";

// Lo que se anota en last_error al cancelar una fila (el motivo).
export const MOTIVO_TURNO_CANCELADO = "El turno se canceló";
export const MOTIVO_TURNO_REPROGRAMADO = "El turno se reprogramó: hay otro recordatorio";
export const MOTIVO_REGLA_INACTIVA = "La regla del recordatorio está desactivada o se borró";
export const MOTIVO_TURNO_NO_VIGENTE = "El turno ya no está confirmado o cambió de horario";
export const MOTIVO_SIN_TELEFONO = "El paciente no tiene teléfono de WhatsApp";
export const MOTIVO_DATOS_BORRADOS = "Se borraron los datos personales del paciente";

/** Las tareas "sin respuesta" no se crean si para entonces faltan menos de
 *  estas horas (§6.5 y decisión de Rocco del 2026-10-10: un turno a menos de
 *  2 h no tiene tarea). */
export const HORAS_ANTES_DEL_TURNO_PARA_LA_TAREA = 2;

const MS_POR_HORA = 60 * 60 * 1000;

export type PoliticaDeTurnoTardio = "NO_ENVIAR" | "EN_EL_MOMENTO" | "HORAS_ANTES";

export interface ConfiguracionDelRecordatorio {
  reminderHoursBefore: number;
  lateBookingReminder: PoliticaDeTurnoTardio;
  lateBookingHoursBefore: number;
}

/**
 * Pura: cuándo sale el recordatorio de un turno que empieza `inicio`, con la
 * configuración vigente de la sede (§6.2). null = no sale.
 *
 *   - Con tiempo: `reminderHoursBefore` horas antes.
 *   - Turno dado con menos anticipación (ese momento ya pasó):
 *       NO_ENVIAR      no sale;
 *       EN_EL_MOMENTO  sale ya;
 *       HORAS_ANTES    `lateBookingHoursBefore` horas antes, o no sale si eso
 *                      también ya pasó.
 *   - Un turno que ya empezó no se recuerda.
 */
export function cuandoSaleElRecordatorio(
  inicio: Date,
  ahora: Date,
  config: ConfiguracionDelRecordatorio,
): Date | null {
  if (inicio.getTime() <= ahora.getTime()) return null;
  const normal = new Date(inicio.getTime() - config.reminderHoursBefore * MS_POR_HORA);
  if (normal.getTime() >= ahora.getTime()) return normal;
  switch (config.lateBookingReminder) {
    case "NO_ENVIAR":
      return null;
    case "EN_EL_MOMENTO":
      return ahora;
    case "HORAS_ANTES": {
      const tarde = new Date(inicio.getTime() - config.lateBookingHoursBefore * MS_POR_HORA);
      return tarde.getTime() >= ahora.getTime() ? tarde : null;
    }
  }
}

/**
 * Pura: cuándo se crea la tarea "sin respuesta" (§6.5): `noResponseTaskHours`
 * después del envío, o 2 h antes del turno si eso es antes. null = no hay
 * tarea, porque para entonces faltan menos de 2 h (o ya pasó el envío).
 */
export function cuandoVaLaTareaSinRespuesta(
  enviado: Date,
  inicio: Date,
  noResponseTaskHours: number,
): Date | null {
  const tope = new Date(inicio.getTime() - HORAS_ANTES_DEL_TURNO_PARA_LA_TAREA * MS_POR_HORA);
  if (tope.getTime() <= enviado.getTime()) return null;
  const despues = new Date(enviado.getTime() + noResponseTaskHours * MS_POR_HORA);
  return despues.getTime() < tope.getTime() ? despues : tope;
}

/** Pura: el {lugar}. El nombre de la clínica si tiene una sola sede; si tiene
 *  más, "Clínica X (sede Y)". */
export function lugarDelTurno(clinica: string, sede: string, sedesDeLaClinica: number): string {
  return sedesDeLaClinica > 1 ? `${clinica} (sede ${sede})` : clinica;
}

/** Pura: el {dia} y la {hora}, en la zona de la sede. */
export function diaYHora(inicio: Date, zona: string): { dia: string; hora: string } {
  const local = DateTime.fromJSDate(inicio, { zone: zona }).setLocale("es");
  return { dia: local.toFormat("cccc d 'de' LLLL"), hora: local.toFormat("HH:mm") };
}

/** last_error sin tokens y cortado a 500 caracteres (el mismo criterio que
 *  last_error_message de los canales de Google, R8). */
export function mensajeDeError(mensaje: string): string {
  return mensaje
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [oculto]")
    .replace(/access_token=[\w.~+/=-]+/gi, "access_token=[oculto]")
    .replace(/EAA[\w-]{10,}/g, "[token oculto]")
    .replace(/ya29\.[\w.-]+/g, "[token oculto]")
    .replace(/1\/\/[\w.-]+/g, "[token oculto]")
    .slice(0, 500);
}
