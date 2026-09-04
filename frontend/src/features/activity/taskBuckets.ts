// ---------------------------------------------------------------------------
// Agrupación por vencimiento de "Mis tareas" (diseño "Mis tareas"). Lógica
// pura, sin React: se prueba sola (taskBuckets.test.ts), mismo espíritu que
// opportunity/boardMove.ts.
//
// Los cinco bloques, en el orden en que se muestran, y su etiqueta:
//   OVERDUE   → "Vencidas"
//   TODAY     → "Hoy"
//   THIS_WEEK → "Esta semana"
//   LATER     → "Más adelante"
//   NO_DATE   → "Sin fecha"
// ---------------------------------------------------------------------------

export type TaskBucket = "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE";

export const TASK_BUCKET_ORDER: readonly TaskBucket[] = [
  "OVERDUE",
  "TODAY",
  "THIS_WEEK",
  "LATER",
  "NO_DATE",
];

export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  OVERDUE: "Vencidas",
  TODAY: "Hoy",
  THIS_WEEK: "Esta semana",
  LATER: "Más adelante",
  NO_DATE: "Sin fecha",
};

// Todo en fecha LOCAL de quien mira: "hoy" y "esta semana" son días
// calendario de su reloj, no de UTC.
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfTomorrow(now: Date): Date {
  const day = startOfDay(now);
  day.setDate(day.getDate() + 1);
  return day;
}

// Semana calendario lunes–domingo. getDay(): 0 = domingo … 6 = sábado.
// Lunes → +7 (el próximo lunes, no hoy), martes → +6, …, domingo → +1.
function startOfNextMonday(now: Date): Date {
  const day = startOfDay(now);
  const weekday = day.getDay();
  day.setDate(day.getDate() + (weekday === 0 ? 1 : 8 - weekday));
  return day;
}

// Reglas, en este orden:
//   a. sin fecha → NO_DATE.
//   b. dueDate < now (instante exacto, ya pasó) → OVERDUE. Es el MISMO
//      criterio de "Vencida" que ya usa ActivityListPage (isOverdue:
//      getTime() < now), no "antes de hoy calendario": una tarea de las
//      11:00 ya está vencida a las 11:01, aunque sea hoy.
//   c. mismo día calendario local que now (antes del inicio de mañana) → TODAY.
//   d. desde mañana hasta antes del próximo lunes → THIS_WEEK.
//   e. el próximo lunes en adelante → LATER.
//
// Si hoy es domingo, THIS_WEEK queda vacío ese día (no quedan días de la
// semana calendario por delante: mañana ya es el próximo lunes) y todo lo
// futuro cae en LATER. Es correcto, no un bug.
export function bucketFor(dueDate: string | null, now: Date): TaskBucket {
  if (dueDate === null) return "NO_DATE";
  const due = new Date(dueDate);
  if (due.getTime() < now.getTime()) return "OVERDUE";
  if (due.getTime() < startOfTomorrow(now).getTime()) return "TODAY";
  if (due.getTime() < startOfNextMonday(now).getTime()) return "THIS_WEEK";
  return "LATER";
}

// Abreviaturas propias en vez de toLocaleDateString: el resultado no
// depende de la versión de ICU del navegador ("sep" vs "sept") y es el
// mismo en los tests que en producción.
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// Texto de la derecha de cada fila. Simplificación DELIBERADA del mockup,
// que varía el formato según el bloque ("28 ago" en vencidas, "hoy 11:00"
// en hoy, "jue 3 sep" en la semana, "15 sep" más adelante): acá hay un
// único criterio para todos los bloques —
//   - null → "Sin fecha"
//   - hoy → "Hoy", o "Hoy, 11:00" si tiene hora
//   - cualquier otro día → "jue 3 sep", o "jue 3 sep, 11:00" si tiene hora;
//     con el año al final solo si no es el año en curso ("jue 3 sep 2025")
// "Tiene hora" = la hora LOCAL no es exactamente medianoche: una tarea
// cargada solo con fecha queda a las 00:00 y no tiene sentido mostrarlo.
export function formatTaskDueDate(dueDate: string | null, now: Date): string {
  if (dueDate === null) return "Sin fecha";
  const due = new Date(dueDate);

  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
  const time = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;

  const isToday =
    due.getTime() >= startOfDay(now).getTime() && due.getTime() < startOfTomorrow(now).getTime();
  if (isToday) return hasTime ? `Hoy, ${time}` : "Hoy";

  const year = due.getFullYear() === now.getFullYear() ? "" : ` ${due.getFullYear()}`;
  const day = `${WEEKDAYS[due.getDay()]} ${due.getDate()} ${MONTHS[due.getMonth()]}${year}`;
  return hasTime ? `${day}, ${time}` : day;
}
