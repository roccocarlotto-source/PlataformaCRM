import { DateTime } from "luxon";

// ---------------------------------------------------------------------------
// Ventanas de mes, semana y día calendario EN LA ZONA DE LA ORGANIZACIÓN, para
// el resumen y la serie de ingresos del Dashboard. Reemplaza a utcMonth.ts y
// utcWindow.ts (T-01).
//
// POR QUÉ EN LA ZONA Y NO EN UTC. Las ventanas eran UTC con el argumento de
// que el servidor no conoce la zona de quien mira. Pero la fecha de cierre de
// una venta SÍ se graba en la zona de la organización (hoyEnLaZona, ítem 154),
// así que las dos mitades del mismo número usaban relojes distintos: entre las
// 00:00 y las 03:00 UTC del día 1, en Buenos Aires seguía siendo el último día
// del mes, la venta se cerraba con esa fecha y el Dashboard ya miraba el mes
// siguiente — ganada hoy, invisible en "este mes". Decisión de Rocco: toda
// ventana del Dashboard se corta en la zona de la organización (o de la
// sucursal, si algún día el Dashboard filtra por sucursal: se le pasa esa
// zona y nada más cambia).
//
// DOS PARES DE LÍMITES POR VENTANA, porque el Dashboard filtra dos clases de
// columna:
//   - `start`/`end`: instantes reales, para timestamps (createdAt). Octubre en
//     Buenos Aires va del 1/10 03:00Z al 1/11 03:00Z.
//   - `startDate`/`endDate`: fechas calendario, para columnas @db.Date
//     (actualCloseDate). Prisma las guarda y las compara como medianoche UTC
//     de ese día, así que octubre es [2026-10-01T00:00Z, 2026-11-01T00:00Z).
//     Filtrar una @db.Date con los instantes de arriba dejaría afuera las
//     ventas del día 1 (guardadas a las 00:00Z, antes de las 03:00Z).
// Las dos describen el MISMO período: lo que cambia con la zona es cuál
// período es "el actual" para `now`, y dónde cae su borde en instantes.
//
// La semana es lunes a domingo (startOf("week") de Luxon es ISO). El horario de
// verano lo resuelve Luxon: un día de cambio de hora dura 23 o 25 horas, y la
// ventana lo respeta porque se calcula en hora de pared, no sumando ms.
//
// El rótulo es la fecha LOCAL de inicio: "YYYY-MM" para meses y "YYYY-MM-DD"
// para semanas y días, el mismo contrato que tenían las ventanas UTC.
// ---------------------------------------------------------------------------

export type PeriodUnit = "month" | "week" | "day";

export interface ZonedWindow {
  label: string;
  // Instantes: el WHERE sobre un timestamp es `gte: start, lt: end`.
  start: Date;
  end: Date;
  // Fechas calendario como medianoche UTC: el WHERE sobre una @db.Date es
  // `gte: startDate, lt: endDate`.
  startDate: Date;
  endDate: Date;
}

const UNIT_PLURAL = { month: "months", week: "weeks", day: "days" } as const;

// Una zona que Luxon no reconoce (no debería pasar: Organization.timezone se
// valida al guardarse, ver utils/timezone.ts) cae a UTC en vez de devolver
// fechas inválidas — el mismo fallback que hoyEnLaZona.
export function zonaValidaOUtc(zona: string | null | undefined): string {
  if (!zona) return "UTC";
  return DateTime.now().setZone(zona).isValid ? zona : "UTC";
}

function fechaComoMedianocheUtc(local: DateTime): Date {
  return new Date(`${local.toISODate()}T00:00:00.000Z`);
}

// La ventana del período que contiene a `now` en `zona`, corrida `offset`
// períodos (0 = el actual, -1 = el anterior).
export function periodWindowInZone(
  unit: PeriodUnit,
  now: Date,
  zona: string,
  offset = 0,
): ZonedWindow {
  const start = DateTime.fromJSDate(now)
    .setZone(zonaValidaOUtc(zona))
    .startOf(unit)
    .plus({ [UNIT_PLURAL[unit]]: offset });
  const end = start.plus({ [UNIT_PLURAL[unit]]: 1 });
  return {
    label: unit === "month" ? start.toFormat("yyyy-MM") : (start.toISODate() ?? ""),
    start: start.toJSDate(),
    end: end.toJSDate(),
    startDate: fechaComoMedianocheUtc(start),
    endDate: fechaComoMedianocheUtc(end),
  };
}

// Los últimos `count` períodos, el actual incluido, en orden cronológico (el
// más viejo primero, el actual —sin cerrar— al final).
export function lastPeriodsInZone(
  unit: PeriodUnit,
  now: Date,
  zona: string,
  count: number,
): ZonedWindow[] {
  return Array.from({ length: count }, (_, index) =>
    periodWindowInZone(unit, now, zona, index - (count - 1)),
  );
}
