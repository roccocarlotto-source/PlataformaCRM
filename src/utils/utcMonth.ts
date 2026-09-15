// ---------------------------------------------------------------------------
// Ventanas de mes calendario en UTC para el resumen del Dashboard (§30 de
// docs/frontend-cambios-pendientes.md). Funciones puras, sin Prisma, para
// probarlas solas (utcMonth.test.ts) — mismo espíritu que taskBuckets.ts en el
// frontend.
//
// TODO EN UTC, y es una decisión, no un descuido: el servidor no conoce la
// zona horaria de quien mira el Dashboard (una organización puede tener
// sucursales en zonas distintas, ver Branch.timezone), así que "este mes" se
// corta a la medianoche UTC. Es la misma clase de aproximación que ya acepta
// el codebase para "Vencida" en ActivityListPage.tsx (un único instante de
// referencia por render). Una oportunidad creada el último día del mes a las
// 22:00 de Montevideo (01:00 UTC del día siguiente) cae en el mes siguiente.
// ---------------------------------------------------------------------------

export interface MonthWindow {
  // "YYYY-MM", el rótulo que viaja al frontend.
  month: string;
  // Primer instante del mes (inclusive) y del mes siguiente (exclusivo):
  // el WHERE es `gte: start, lt: end`.
  start: Date;
  end: Date;
}

export function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Date.UTC normaliza el mes fuera de rango (mes 12 → enero del año
// siguiente, mes -1 → diciembre del anterior), así que alcanza con sumar.
export function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function startOfNextMonthUTC(date: Date): Date {
  return addMonthsUTC(startOfMonthUTC(date), 1);
}

export function startOfPreviousMonthUTC(date: Date): Date {
  return addMonthsUTC(startOfMonthUTC(date), -1);
}

export function monthKeyUTC(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

// La ventana del mes que contiene a `date`, corrida `offsetMonths` meses
// (0 = ese mes, -1 = el anterior).
export function monthWindowUTC(date: Date, offsetMonths = 0): MonthWindow {
  const start = addMonthsUTC(startOfMonthUTC(date), offsetMonths);
  return { month: monthKeyUTC(start), start, end: addMonthsUTC(start, 1) };
}

// Los últimos `count` meses calendario, el actual incluido, en orden
// cronológico (el más viejo primero, el actual al final).
export function lastMonthsUTC(now: Date, count: number): MonthWindow[] {
  return Array.from({ length: count }, (_, index) => monthWindowUTC(now, index - (count - 1)));
}
