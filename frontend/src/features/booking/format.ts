import type { BadgeVariant } from "../../design-system/Badge";
import type { BookingStatus } from "./types";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
  NO_SHOW: "No se presentó",
};

export const BOOKING_STATUS_BADGE: Record<BookingStatus, BadgeVariant> = {
  CONFIRMED: "info",
  CANCELLED: "neutral",
  COMPLETED: "success",
  NO_SHOW: "danger",
};

export const BOOKING_STATUS_OPTIONS = (Object.keys(BOOKING_STATUS_LABEL) as BookingStatus[]).map(
  (value) => ({ value, label: BOOKING_STATUS_LABEL[value] }),
);

// "lun 22/09/2026, 09:00–09:30" en la zona de la SUCURSAL, no en la del
// navegador: una reserva de las 9 en Santiago es de las 9 para quien la
// atiende, aunque la mire alguien en Montevideo. Sin zona (sucursal sin
// resolver), cae a la del navegador.
export function formatRangoDeReserva(startsAt: string, endsAt: string, timeZone?: string): string {
  const fecha = new Intl.DateTimeFormat("es-UY", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(startsAt));
  const hora = new Intl.DateTimeFormat("es-UY", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${fecha}, ${hora.format(new Date(startsAt))}–${hora.format(new Date(endsAt))}`;
}

// "AAAA-MM-DD" de un <input type="date"> → instante ISO con zona para el
// filtro `from`/`to`. La fecha se interpreta en la zona del NAVEGADOR (es la
// que la persona tiene en la cabeza al elegir el día). `to` es exclusivo en el
// backend (startsAt < to), así que para incluir el día elegido entero se manda
// la medianoche del día SIGUIENTE.
export function fechaAInstante(fecha: string, finDelDia: boolean): string | undefined {
  if (!fecha) return undefined;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return undefined;
  return new Date(anio, mes - 1, finDelDia ? dia + 1 : dia).toISOString();
}

// Hoy en la zona del navegador, como "AAAA-MM-DD" para un <input type="date">.
export function hoyComoFecha(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}
