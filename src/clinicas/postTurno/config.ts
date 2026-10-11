// ---------------------------------------------------------------------------
// Después del turno (docs/rubros.md §7, R14): el QR de reseña y el control.
// Solo clínicas (módulo post_turno). No toca QrFollowUp ni el QR de una
// automotora, que sigue colgando de opportunity.won (ediciones §3): para una
// clínica, el disparador es el turno atendido.
// ---------------------------------------------------------------------------

export const TRIGGER_BOOKING_COMPLETED = "booking.completed";
export const ACTION_BOOKING_SEND_QR_REVIEW = "booking.send_qr_review";
export const ACTION_BOOKING_SCHEDULE_CONTROL = "booking.schedule_control";

/** §7.1: la demora mínima del QR en una clínica, para dar tiempo a corregir un
 *  "No vino". */
export const DEMORA_MINIMA_DEL_QR_MIN = 3 * 60;

/** Decisión de Rocco (2026-10-10): después de un cierre automático (R10), la
 *  reseña sale 24 h después del cierre, no con la demora de la regla. */
export const ESPERA_TRAS_CIERRE_AUTOMATICO_MS = 24 * 60 * 60 * 1000;

/** §7.2: el tope de "Recordar control a los N días" (CHECK de la migración). */
export const MAX_DIAS_DE_CONTROL = 730;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** El texto con el que arranca la regla del control (espejo en
 *  frontend/src/features/automation/catalog.ts). Sin datos de salud. */
export const TEXTO_POR_DEFECTO_DEL_CONTROL =
  "Hola {nombre}, ya pasaron {semanas} semanas desde tu último turno en {lugar}. Si querés agendar el próximo, escribinos por acá.";

/** El del QR de reseña: el mismo molde que el de una automotora, sin la
 *  compra. */
export const TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA =
  "Hola {nombre}, gracias por venir. Si querés contarnos cómo te fue, podés dejarnos tu reseña acá: {link} ¡Gracias!";

// Los motivos con que se cancela una fila (last_error).
export const MOTIVO_NO_VINO = "El turno se marcó como No vino";
export const MOTIVO_TURNO_NO_ATENDIDO = "El turno ya no está como atendido";
export const MOTIVO_TURNO_FUTURO_DE_LA_PRESTACION =
  "El paciente ya tiene un turno futuro de esa prestación";
export const MOTIVO_SIN_INTERES = "El paciente está marcado sin interés";
export const MOTIVO_QR_BORRADO = "El QR de la regla ya no existe";

/** Pura: cuándo sale el QR de reseña. Cierre automático: 24 h después del
 *  cierre. Si no, la demora de la regla (nunca menos de 3 h). */
export function cuandoSaleElQr(completedAt: Date, demoraMin: number, automatico: boolean): Date {
  if (automatico) return new Date(completedAt.getTime() + ESPERA_TRAS_CIERRE_AUTOMATICO_MS);
  const demora = Math.max(demoraMin, DEMORA_MINIMA_DEL_QR_MIN);
  return new Date(completedAt.getTime() + demora * 60 * 1000);
}

/** Pura: cuándo sale el control (el horario de la sede lo corre el worker). */
export function cuandoSaleElControl(completedAt: Date, dias: number): Date {
  return new Date(completedAt.getTime() + dias * MS_POR_DIA);
}

/** Pura: el {semanas} del control. N/7 redondeado, al menos 1. */
export function semanasDelControl(dias: number): string {
  return String(Math.max(1, Math.round(dias / 7)));
}
