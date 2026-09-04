import { describe, expect, it } from "vitest";
import { bucketFor, formatTaskDueDate } from "./taskBuckets";

// Todas las fechas se construyen con el constructor local (año, mes, día,
// hora), nunca desde un ISO UTC: las reglas son en hora local y así el test
// da lo mismo en cualquier zona horaria.

// Jueves 3 de septiembre de 2026, 11:00 local.
const THU = new Date(2026, 8, 3, 11, 0);
const iso = (date: Date) => date.toISOString();

describe("bucketFor", () => {
  it("sin fecha → NO_DATE", () => {
    expect(bucketFor(null, THU)).toBe("NO_DATE");
  });

  it("vencida: instante exacto anterior a now, aunque sea hoy (mismo criterio que ActivityListPage)", () => {
    expect(bucketFor(iso(new Date(2026, 8, 3, 10, 59)), THU)).toBe("OVERDUE");
    expect(bucketFor(iso(new Date(2026, 7, 28, 9, 0)), THU)).toBe("OVERDUE");
  });

  it("hoy: desde now hasta antes de medianoche", () => {
    expect(bucketFor(iso(THU), THU)).toBe("TODAY");
    expect(bucketFor(iso(new Date(2026, 8, 3, 16, 30)), THU)).toBe("TODAY");
    expect(bucketFor(iso(new Date(2026, 8, 3, 23, 59, 59)), THU)).toBe("TODAY");
  });

  it("límite exacto de medianoche entre HOY/VENCIDA: a las 00:00 del día, una tarea de las 00:00 es HOY y una de ayer 23:59 está VENCIDA", () => {
    const midnight = new Date(2026, 8, 3, 0, 0);
    expect(bucketFor(iso(midnight), midnight)).toBe("TODAY");
    expect(bucketFor(iso(new Date(2026, 8, 2, 23, 59)), midnight)).toBe("OVERDUE");
    // Y al día siguiente a las 00:00, la de las 00:00 de hoy ya venció.
    const nextMidnight = new Date(2026, 8, 4, 0, 0);
    expect(bucketFor(iso(midnight), nextMidnight)).toBe("OVERDUE");
  });

  it("esta semana: desde mañana hasta el domingo inclusive (semana lunes–domingo)", () => {
    expect(bucketFor(iso(new Date(2026, 8, 4, 0, 0)), THU)).toBe("THIS_WEEK"); // viernes 00:00
    expect(bucketFor(iso(new Date(2026, 8, 6, 23, 59)), THU)).toBe("THIS_WEEK"); // domingo
  });

  it("más adelante: el próximo lunes 00:00 en adelante", () => {
    expect(bucketFor(iso(new Date(2026, 8, 7, 0, 0)), THU)).toBe("LATER"); // lunes 7
    expect(bucketFor(iso(new Date(2026, 9, 15, 10, 0)), THU)).toBe("LATER");
  });

  it("caso límite domingo: THIS_WEEK queda vacío, todo lo futuro es LATER", () => {
    const sunday = new Date(2026, 8, 6, 9, 0); // domingo 6 de septiembre
    expect(bucketFor(iso(new Date(2026, 8, 6, 18, 0)), sunday)).toBe("TODAY");
    expect(bucketFor(iso(new Date(2026, 8, 7, 9, 0)), sunday)).toBe("LATER"); // lunes
    expect(bucketFor(iso(new Date(2026, 8, 12, 9, 0)), sunday)).toBe("LATER"); // sábado siguiente
  });

  it("un lunes, la semana llega hasta el domingo, no hasta hoy", () => {
    const monday = new Date(2026, 8, 7, 9, 0);
    expect(bucketFor(iso(new Date(2026, 8, 13, 9, 0)), monday)).toBe("THIS_WEEK"); // domingo 13
    expect(bucketFor(iso(new Date(2026, 8, 14, 9, 0)), monday)).toBe("LATER"); // lunes 14
  });
});

describe("formatTaskDueDate", () => {
  it("null → 'Sin fecha'", () => {
    expect(formatTaskDueDate(null, THU)).toBe("Sin fecha");
  });

  it("hoy a medianoche → 'Hoy'; hoy con hora → 'Hoy, HH:mm'", () => {
    expect(formatTaskDueDate(iso(new Date(2026, 8, 3, 0, 0)), THU)).toBe("Hoy");
    expect(formatTaskDueDate(iso(new Date(2026, 8, 3, 16, 30)), THU)).toBe("Hoy, 16:30");
    expect(formatTaskDueDate(iso(new Date(2026, 8, 3, 9, 5)), THU)).toBe("Hoy, 09:05");
  });

  it("otro día sin hora → 'vie 4 sep'; con hora → 'vie 4 sep, 11:00'", () => {
    expect(formatTaskDueDate(iso(new Date(2026, 8, 4, 0, 0)), THU)).toBe("vie 4 sep");
    expect(formatTaskDueDate(iso(new Date(2026, 8, 4, 11, 0)), THU)).toBe("vie 4 sep, 11:00");
    // Una vencida usa el mismo formato: no cambia por bloque.
    expect(formatTaskDueDate(iso(new Date(2026, 7, 28, 0, 0)), THU)).toBe("vie 28 ago");
  });

  it("agrega el año solo cuando no es el año en curso", () => {
    expect(formatTaskDueDate(iso(new Date(2025, 11, 1, 0, 0)), THU)).toBe("lun 1 dic 2025");
    expect(formatTaskDueDate(iso(new Date(2027, 0, 4, 10, 0)), THU)).toBe("lun 4 ene 2027, 10:00");
  });
});
