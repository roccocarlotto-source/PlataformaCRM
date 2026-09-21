import { minutos } from "../resource/workingHours";
import type { Weekday, WorkingHoursSlot } from "../resource/types";

// ---------------------------------------------------------------------------
// Aritmética del calendario de la Agenda (ítem 77), pura y sin React.
//
// TODO VIVE EN LA ZONA DE LA SUCURSAL. El día que se elige es un día de
// calendario de la sucursal, el horario de trabajo es "HH:MM" de la sucursal
// (mismo criterio que el backend: la zona sale de Branch.timezone, nunca del
// servidor ni del navegador) y las reservas llegan como instantes UTC que se
// ubican en la grilla según la hora LOCAL de la sucursal. Quien mira desde otra
// zona ve la agenda como la ve el mostrador.
//
// Las reglas del backend (generarGrilla/estaEnLaGrilla en
// src/utils/workingHours.ts) se replican acá en minutos del día solo para
// DECIDIR SI MOSTRAR el checkbox de forzar: la validación real sigue siendo la
// del backend, que es la que responde si el horario vale.
// ---------------------------------------------------------------------------

// Alto de la grilla: un renglón cada media hora, el día entero. El día entero
// y no solo el horario abierto porque un ADMIN puede forzar a cualquier hora;
// la página arranca con el scroll en la mañana.
export const MINUTOS_POR_RENGLON = 30;
export const MINUTOS_DEL_DIA = 24 * 60;

// Date#getUTCDay (0 = domingo) → el enum del backend.
const WEEKDAY_POR_INDICE: readonly Weekday[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function partesDeFecha(fecha: string): [number, number, number] | undefined {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return undefined;
  return [anio, mes, dia];
}

// "AAAA-MM-DD" ± n días. En UTC a propósito: es aritmética de calendario, no
// de instantes, y así no la toca ningún cambio de hora.
export function sumarDias(fecha: string, dias: number): string {
  const partes = partesDeFecha(fecha);
  if (!partes) return fecha;
  const [anio, mes, dia] = partes;
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

export function diaDeLaSemana(fecha: string): Weekday | undefined {
  const partes = partesDeFecha(fecha);
  if (!partes) return undefined;
  const [anio, mes, dia] = partes;
  return WEEKDAY_POR_INDICE[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
}

// Diferencia entre la hora de pared de `zona` y UTC en ese instante, en ms.
function desfasaje(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instante));
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour"),
    valor("minute"),
    valor("second"),
  );
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

// El instante real de "fecha a los `minuto` minutos del día" en la zona. Dos
// pasadas para el desfasaje: la primera lo mide en un instante aproximado, y
// si justo cruza un cambio de hora la segunda lo corrige. `minuto` puede ser
// 1440 (medianoche del día siguiente): Date.UTC desborda al día siguiente.
export function instanteLocal(fecha: string, minuto: number, zona: string): Date {
  const partes = partesDeFecha(fecha);
  if (!partes) return new Date(Number.NaN);
  const [anio, mes, dia] = partes;
  const deParedComoUtc = Date.UTC(anio, mes - 1, dia, 0, minuto);
  const primero = deParedComoUtc - desfasaje(deParedComoUtc, zona);
  const segundo = deParedComoUtc - desfasaje(primero, zona);
  return new Date(segundo);
}

// Minuto del día `fecha` (en la zona) en el que cae un instante, acotado a
// [0, 1440]: una reserva que termina después de medianoche se corta al final
// de la grilla del día.
export function minutoDelDia(instante: string | Date, fecha: string, zona: string): number {
  const ms = new Date(instante).getTime();
  const inicioDelDia = instanteLocal(fecha, 0, zona).getTime();
  const finDelDia = instanteLocal(fecha, MINUTOS_DEL_DIA, zona).getTime();
  if (ms <= inicioDelDia) return 0;
  if (ms >= finDelDia) return MINUTOS_DEL_DIA;
  const local = ms + desfasaje(ms, zona);
  const inicioLocal = inicioDelDia + desfasaje(inicioDelDia, zona);
  return Math.round((local - inicioLocal) / 60000);
}

export interface FranjaEnMinutos {
  inicio: number;
  fin: number;
}

// Las franjas del día de la semana de `fecha`, en minutos, ordenadas.
export function franjasDelDia(
  slots: readonly WorkingHoursSlot[],
  fecha: string,
): FranjaEnMinutos[] {
  const dia = diaDeLaSemana(fecha);
  return slots
    .filter((slot) => slot.weekday === dia)
    .map((slot) => ({ inicio: minutos(slot.startTime), fin: minutos(slot.endTime) }))
    .filter(
      (franja): franja is FranjaEnMinutos =>
        franja.inicio !== undefined && franja.fin !== undefined,
    )
    .sort((a, b) => a.inicio - b.inicio);
}

// ¿[inicio, fin) cae entero dentro de alguna franja? Lo que el backend llama
// estaDentroDelHorario.
export function estaAbierto(inicio: number, fin: number, franjas: readonly FranjaEnMinutos[]) {
  return franjas.some((franja) => inicio >= franja.inicio && fin <= franja.fin);
}

// ¿Un turno de `duracionMin` que empieza en `inicio` es uno de los que la
// grilla del backend ofrece? Contenido en una franja Y a un múltiplo de la
// duración desde el borde de esa franja (generarGrilla).
export function estaEnLaGrilla(
  inicio: number,
  duracionMin: number,
  franjas: readonly FranjaEnMinutos[],
): boolean {
  const fin = inicio + duracionMin;
  return franjas.some(
    (franja) =>
      inicio >= franja.inicio && fin <= franja.fin && (inicio - franja.inicio) % duracionMin === 0,
  );
}

export function formatearMinuto(minuto: number): string {
  const horas = Math.floor(minuto / 60);
  const mins = minuto % 60;
  return `${String(horas).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
