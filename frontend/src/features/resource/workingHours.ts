import type { Weekday, WorkingHoursSlot } from "./types";

// ---------------------------------------------------------------------------
// Horario laboral de un recurso, del lado del cliente (ítem 75).
//
// El formulario lo edita DÍA POR DÍA (un arreglo de franjas por cada día, que
// puede estar vacío) y lo manda al backend APLANADO, como la semana entera que
// pide el PUT. Las dos traducciones y la validación viven acá, puras, para que
// el editor no valide nada y el formulario lo haga en un solo lugar al enviar
// — mismo reparto que source/fieldMapping.ts y FieldMappingEditor.
// ---------------------------------------------------------------------------

// Lunes primero, como se lee una semana laboral acá (y no domingo primero
// como en Date#getDay).
export const WEEKDAYS: readonly Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  MONDAY: "Lunes",
  TUESDAY: "Martes",
  WEDNESDAY: "Miércoles",
  THURSDAY: "Jueves",
  FRIDAY: "Viernes",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

// El tope del backend (reemplazarHorarioSchema en workingHours.controller.ts).
export const MAX_FRANJAS = 50;

export interface Franja {
  startTime: string;
  endTime: string;
}

export type HorarioSemanal = Record<Weekday, Franja[]>;

export function horarioVacio(): HorarioSemanal {
  return {
    MONDAY: [],
    TUESDAY: [],
    WEDNESDAY: [],
    THURSDAY: [],
    FRIDAY: [],
    SATURDAY: [],
    SUNDAY: [],
  };
}

// Lo que devuelve el GET → el estado del editor. Cada día ordenado por hora de
// inicio: el backend no promete orden, y una grilla desordenada no se lee.
export function agruparPorDia(slots: readonly WorkingHoursSlot[]): HorarioSemanal {
  const horario = horarioVacio();
  for (const slot of slots) {
    horario[slot.weekday].push({ startTime: slot.startTime, endTime: slot.endTime });
  }
  for (const dia of WEEKDAYS) {
    horario[dia].sort((a, b) => (minutos(a.startTime) ?? 0) - (minutos(b.startTime) ?? 0));
  }
  return horario;
}

// El estado del editor → el cuerpo del PUT (la semana entera, aplanada).
export function aplanar(horario: HorarioSemanal): WorkingHoursSlot[] {
  return WEEKDAYS.flatMap((weekday) =>
    horario[weekday].map((franja) => ({
      weekday,
      startTime: franja.startTime.trim(),
      endTime: franja.endTime.trim(),
    })),
  );
}

const FORMATO_HORA = /^(\d{2}):(\d{2})$/;

// "HH:MM" → minutos desde la medianoche, o undefined si no es una hora válida.
// Misma regla que minutosDesdeHoraLocal del backend: 00:00 a 23:59, más
// "24:00" como fin del día.
export function minutos(hora: string): number | undefined {
  const match = FORMATO_HORA.exec(hora.trim());
  if (!match) return undefined;
  const horas = Number(match[1]);
  const mins = Number(match[2]);
  if (horas === 24 && mins === 0) return 24 * 60;
  if (horas > 23 || mins > 59) return undefined;
  return horas * 60 + mins;
}

function formatear(total: number): string {
  const horas = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(horas).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// La franja que ofrece "Agregar franja": 09:00–18:00 en un día vacío, y en uno
// que ya tiene franjas, la hora siguiente a la última (una tarde después de una
// mañana). Solo es un punto de partida editable; si no entra antes de las
// 24:00, vuelve al default y la validación dirá lo que haga falta.
export function franjaSugerida(delDia: readonly Franja[]): Franja {
  const ultimoFin = delDia.length > 0 ? minutos(delDia[delDia.length - 1].endTime) : undefined;
  if (ultimoFin !== undefined && ultimoFin + 60 <= 24 * 60) {
    return { startTime: formatear(ultimoFin), endTime: formatear(ultimoFin + 60) };
  }
  return { startTime: "09:00", endTime: "18:00" };
}

// El primer problema del horario, en una frase para la persona, o null si puede
// viajar. Repite a propósito lo que el backend también valida (formato, inicio
// antes que fin, tope de 50 y —en el service, no en Zod— la superposición entre
// franjas del mismo día): el 400 del backend nombra el día en inglés
// ("MONDAY") y no dice qué franjas se pisan; acá sí.
//
// Un horario VACÍO es válido: significa "este recurso no atiende".
export function validarHorario(horario: HorarioSemanal): string | null {
  let total = 0;

  for (const dia of WEEKDAYS) {
    const nombre = WEEKDAY_LABEL[dia];
    const conMinutos: { franja: Franja; inicio: number; fin: number }[] = [];

    for (const franja of horario[dia]) {
      const inicio = minutos(franja.startTime);
      const fin = minutos(franja.endTime);
      if (inicio === undefined || fin === undefined || inicio === 24 * 60) {
        return `${nombre}: las horas tienen que tener formato HH:MM, entre 00:00 y 24:00 (por ejemplo 09:00).`;
      }
      if (inicio >= fin) {
        return `${nombre}: la franja ${franja.startTime}–${franja.endTime} tiene que empezar antes de terminar.`;
      }
      conMinutos.push({ franja, inicio, fin });
    }

    const ordenadas = [...conMinutos].sort((a, b) => a.inicio - b.inicio);
    for (let i = 1; i < ordenadas.length; i++) {
      // Tocarse no es pisarse: 09:00–13:00 y 13:00–18:00 conviven, igual que en
      // encontrarFranjasSuperpuestas del backend (start < fin anterior).
      if (ordenadas[i].inicio < ordenadas[i - 1].fin) {
        const a = ordenadas[i - 1].franja;
        const b = ordenadas[i].franja;
        return `${nombre}: las franjas ${a.startTime}–${a.endTime} y ${b.startTime}–${b.endTime} se superponen.`;
      }
    }

    total += horario[dia].length;
  }

  if (total > MAX_FRANJAS) {
    return `El horario tiene ${total} franjas y el máximo por recurso es ${MAX_FRANJAS}.`;
  }

  return null;
}
