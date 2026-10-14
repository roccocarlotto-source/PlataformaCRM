import { ApiError } from "../../lib/api";
import { VEHICULO_DUPLICADO, type Aprobacion, type EstadoDeOrden, type MotivoDeFin } from "./types";

// Textos y formatos del taller (docs/servicios.md §4).

/** "2027-01-10" → la fecha en el formato local, sin pasar por UTC: una fecha
 *  sin hora es ese día en cualquier zona (formatDateOnly la correría un día
 *  para atrás en Uruguay). */
export function formatearFecha(fecha: string | null): string {
  if (!fecha) return "";
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString();
}

export const ETIQUETA_DE_MOTIVO: Readonly<Record<MotivoDeFin, string>> = {
  VENDIDO_A_TERCERO: "Lo vendió a un tercero",
  PERMUTA: "Entró a nuestro stock (permuta)",
  OTRO: "Otro motivo",
};

export const ETIQUETA_DE_ESTADO: Readonly<Record<EstadoDeOrden, string>> = {
  AGENDADO: "Agendado",
  RECIBIDO: "Recibido",
  EN_TRABAJO: "En trabajo",
  ESPERANDO_APROBACION: "Esperando aprobación",
  LISTO_PARA_RETIRAR: "Listo para retirar",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

export function nombreDe(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

/** "Toyota Hilux 2020" */
export function descripcionDe(v: { make: string; model: string; year: number | null }): string {
  return [v.make, v.model, v.year].filter(Boolean).join(" ");
}

/** El id del vehículo que ya tiene la matrícula o el chasis, si el error es el
 *  409 de duplicado. */
export function vehiculoDuplicadoDe(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (err.details?.code !== VEHICULO_DUPLICADO) return null;
  return typeof err.details.vehiculoId === "string" ? err.details.vehiculoId : null;
}

/** <input type="datetime-local"> ↔ ISO: el input trabaja en la hora local. */
export function aInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export function deInputLocal(valor: string): string | null {
  return valor ? new Date(valor).toISOString() : null;
}

/** "1234.5" → 1234.5; "" → null. */
export function aMonto(valor: string): number | null {
  if (!valor.trim()) return null;
  return Number(valor.replace(",", "."));
}

export const ETIQUETA_DE_CANAL: Readonly<Record<Aprobacion["channel"], string>> = {
  TELEFONO: "Teléfono",
  WHATSAPP: "WhatsApp",
  PRESENCIAL: "En persona",
  OTRO: "Otro",
};
