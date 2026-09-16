// ---------------------------------------------------------------------------
// Ventanas de semana y de día calendario en UTC para la serie de ingresos del
// Dashboard (§33 de docs/frontend-cambios-pendientes.md). Es el hermano de
// utcMonth.ts, que queda tal cual: las ventanas de mes las sigue calculando
// aquel archivo y las sigue usando getDashboardSummary sin enterarse de esto.
//
// TODO EN UTC, por el mismo motivo que ahí: el servidor no conoce la zona
// horaria de quien mira el Dashboard (una organización puede tener sucursales
// en zonas distintas, ver Branch.timezone), así que cada ventana se corta a la
// medianoche UTC. Con granularidad diaria la aproximación se nota más que con
// la mensual —una oportunidad cerrada a las 22:00 de Montevideo cae en el día
// siguiente— y es una decisión consciente, no un descuido: el mismo criterio
// aplicado a un bucket más chico.
//
// El rótulo de una ventana de semana o de día es su fecha de inicio en
// "YYYY-MM-DD", el análogo del "YYYY-MM" de utcMonth.ts: el backend manda la
// clave cruda y el frontend decide cómo mostrarla. A propósito NO se calcula
// el número de semana ISO: es más lío del que vale, y una fecha ya es clara.
// ---------------------------------------------------------------------------

export interface DateWindow {
  // "YYYY-MM-DD", el rótulo que viaja al frontend.
  label: string;
  // Primer instante de la ventana (inclusive) y de la siguiente (exclusivo):
  // el WHERE es `gte: start, lt: end`.
  start: Date;
  end: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" del instante, en UTC. toISOString() ya es UTC por definición,
// así que el recorte no puede arrastrar la zona horaria del proceso.
export function dateKeyUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Sumar días en UTC es sumar milisegundos: en UTC no hay horario de verano,
// así que todos los días duran exactamente lo mismo (en hora local NO
// alcanzaría con esto).
export function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function startOfNextDayUTC(date: Date): Date {
  return addDaysUTC(startOfDayUTC(date), 1);
}

// getUTCDay() devuelve 0 para domingo: (día + 6) % 7 da cuántos días hay que
// retroceder hasta el lunes (lunes 0, domingo 6).
export function startOfWeekUTC(date: Date): Date {
  const start = startOfDayUTC(date);
  return addDaysUTC(start, -((start.getUTCDay() + 6) % 7));
}

export function addWeeksUTC(date: Date, weeks: number): Date {
  return addDaysUTC(date, weeks * 7);
}

export function startOfNextWeekUTC(date: Date): Date {
  return addWeeksUTC(startOfWeekUTC(date), 1);
}

// La ventana del día que contiene a `date`, corrida `offsetDays` días
// (0 = ese día, -1 = el anterior).
export function dayWindowUTC(date: Date, offsetDays = 0): DateWindow {
  const start = addDaysUTC(startOfDayUTC(date), offsetDays);
  return { label: dateKeyUTC(start), start, end: addDaysUTC(start, 1) };
}

// Ídem para la semana lunes-a-domingo que contiene a `date`.
export function weekWindowUTC(date: Date, offsetWeeks = 0): DateWindow {
  const start = addWeeksUTC(startOfWeekUTC(date), offsetWeeks);
  return { label: dateKeyUTC(start), start, end: addWeeksUTC(start, 1) };
}

// Los últimos `count` días calendario, el de hoy incluido, en orden
// cronológico (el más viejo primero, el actual al final) — el mismo contrato
// que lastMonthsUTC.
export function lastDaysUTC(now: Date, count: number): DateWindow[] {
  return Array.from({ length: count }, (_, index) => dayWindowUTC(now, index - (count - 1)));
}

// Ídem para semanas: la semana en curso queda última, sin cerrar.
export function lastWeeksUTC(now: Date, count: number): DateWindow[] {
  return Array.from({ length: count }, (_, index) => weekWindowUTC(now, index - (count - 1)));
}
