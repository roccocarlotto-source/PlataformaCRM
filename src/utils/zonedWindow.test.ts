import assert from "node:assert/strict";
import { test } from "node:test";
import { lastPeriodsInZone, periodWindowInZone, zonaValidaOUtc } from "./zonedWindow";

// Todos los `now` están fijos: nada acá depende de la hora en que corre el CI.
// Buenos Aires es UTC-3 todo el año (sin horario de verano), así que sus bordes
// son siempre las 03:00Z — el caso que rompió el test O2 el 1/10/2026 a las
// 02:01Z (T-01).
const BA = "America/Argentina/Buenos_Aires";

function iso(d: Date): string {
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Borde de mes: 00:00–03:00 UTC del día 1
// ---------------------------------------------------------------------------

test("mes: el 1/10 a las 02:01Z en Buenos Aires todavía es septiembre", () => {
  const w = periodWindowInZone("month", new Date("2026-10-01T02:01:00.000Z"), BA);
  assert.equal(w.label, "2026-09");
  // Instantes (para createdAt): medianoche de Buenos Aires.
  assert.equal(iso(w.start), "2026-09-01T03:00:00.000Z");
  assert.equal(iso(w.end), "2026-10-01T03:00:00.000Z");
  // Fechas calendario (para actualCloseDate @db.Date): medianoche UTC del día.
  assert.equal(iso(w.startDate), "2026-09-01T00:00:00.000Z");
  assert.equal(iso(w.endDate), "2026-10-01T00:00:00.000Z");
});

test("mes: todo el tramo 00:00–02:59:59.999Z del día 1 es el mes anterior; 03:00Z ya es el nuevo", () => {
  for (const instante of [
    "2026-10-01T00:00:00.000Z",
    "2026-10-01T01:30:00.000Z",
    "2026-10-01T02:59:59.999Z",
  ]) {
    assert.equal(periodWindowInZone("month", new Date(instante), BA).label, "2026-09", instante);
  }
  const octubre = periodWindowInZone("month", new Date("2026-10-01T03:00:00.000Z"), BA);
  assert.equal(octubre.label, "2026-10");
  assert.equal(iso(octubre.startDate), "2026-10-01T00:00:00.000Z");
});

test("mes: el período anterior en el borde es agosto, y cruza el año en enero", () => {
  const anterior = periodWindowInZone("month", new Date("2026-10-01T02:01:00.000Z"), BA, -1);
  assert.equal(anterior.label, "2026-08");
  assert.equal(iso(anterior.start), "2026-08-01T03:00:00.000Z");
  assert.equal(iso(anterior.endDate), "2026-09-01T00:00:00.000Z");

  // 1/1/2027 a la 01:00Z: en Buenos Aires es la noche del 31/12/2026.
  const fin = periodWindowInZone("month", new Date("2027-01-01T01:00:00.000Z"), BA);
  assert.equal(fin.label, "2026-12");
  assert.equal(iso(fin.endDate), "2027-01-01T00:00:00.000Z");
});

test("mes: en una zona adelantada a UTC el borde va para el otro lado", () => {
  // 30/9 a las 16:00Z ya es el 1/10 a la 01:00 en Tokio (UTC+9).
  const w = periodWindowInZone("month", new Date("2026-09-30T16:00:00.000Z"), "Asia/Tokyo");
  assert.equal(w.label, "2026-10");
  assert.equal(iso(w.start), "2026-09-30T15:00:00.000Z");
  assert.equal(iso(w.startDate), "2026-10-01T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Borde de semana (lunes a domingo) y de día
// ---------------------------------------------------------------------------

test("semana: el lunes 5/10 a las 02:00Z en Buenos Aires sigue siendo la semana del lunes 28/9", () => {
  const w = periodWindowInZone("week", new Date("2026-10-05T02:00:00.000Z"), BA);
  assert.equal(w.label, "2026-09-28");
  assert.equal(iso(w.start), "2026-09-28T03:00:00.000Z");
  assert.equal(iso(w.end), "2026-10-05T03:00:00.000Z");
  assert.equal(iso(w.startDate), "2026-09-28T00:00:00.000Z");
  assert.equal(iso(w.endDate), "2026-10-05T00:00:00.000Z");

  const nueva = periodWindowInZone("week", new Date("2026-10-05T03:00:00.000Z"), BA);
  assert.equal(nueva.label, "2026-10-05");
});

test("semana: un lunes local es su propio inicio y el domingo local es el último día", () => {
  // Lunes 28/9 a las 10:00 de Buenos Aires.
  assert.equal(
    periodWindowInZone("week", new Date("2026-09-28T13:00:00.000Z"), BA).label,
    "2026-09-28",
  );
  // Domingo 4/10 a las 23:59 de Buenos Aires (05/10 02:59Z).
  assert.equal(
    periodWindowInZone("week", new Date("2026-10-05T02:59:00.000Z"), BA).label,
    "2026-09-28",
  );
});

test("día: 02:00Z del 1/10 es todavía el 30/9 en Buenos Aires; hoy y ayer con sus dos pares de límites", () => {
  const hoy = periodWindowInZone("day", new Date("2026-10-01T02:00:00.000Z"), BA);
  assert.equal(hoy.label, "2026-09-30");
  assert.equal(iso(hoy.start), "2026-09-30T03:00:00.000Z");
  assert.equal(iso(hoy.end), "2026-10-01T03:00:00.000Z");
  assert.equal(iso(hoy.startDate), "2026-09-30T00:00:00.000Z");
  assert.equal(iso(hoy.endDate), "2026-10-01T00:00:00.000Z");

  const ayer = periodWindowInZone("day", new Date("2026-10-01T02:00:00.000Z"), BA, -1);
  assert.equal(ayer.label, "2026-09-29");
});

// ---------------------------------------------------------------------------
// Horario de verano: la ventana sigue la hora de pared, no suma 24 h
// ---------------------------------------------------------------------------

test("día de cambio de hora: dura 23 horas y la fecha calendario sigue siendo un día", () => {
  // Madrid adelanta el reloj el domingo 29/3/2026 (02:00 → 03:00).
  const w = periodWindowInZone("day", new Date("2026-03-29T12:00:00.000Z"), "Europe/Madrid");
  assert.equal(w.label, "2026-03-29");
  assert.equal(iso(w.start), "2026-03-28T23:00:00.000Z");
  assert.equal(iso(w.end), "2026-03-29T22:00:00.000Z");
  assert.equal(w.end.getTime() - w.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(iso(w.startDate), "2026-03-29T00:00:00.000Z");
  assert.equal(iso(w.endDate), "2026-03-30T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// UTC: mismo resultado que las ventanas UTC de antes
// ---------------------------------------------------------------------------

test("en UTC instantes y fechas coinciden, y el borde es la medianoche UTC", () => {
  const ahora = new Date("2026-03-15T23:30:00.000Z"); // domingo
  const mes = periodWindowInZone("month", ahora, "UTC");
  assert.equal(mes.label, "2026-03");
  assert.equal(iso(mes.start), "2026-03-01T00:00:00.000Z");
  assert.equal(iso(mes.end), iso(mes.endDate));
  const semana = periodWindowInZone("week", ahora, "UTC");
  assert.equal(semana.label, "2026-03-09");
  assert.equal(iso(semana.end), "2026-03-16T00:00:00.000Z");
  const dia = periodWindowInZone("day", ahora, "UTC");
  assert.equal(dia.label, "2026-03-15");
});

// ---------------------------------------------------------------------------
// Series y zona inválida
// ---------------------------------------------------------------------------

test("lastPeriodsInZone: N ventanas contiguas, cronológicas, la actual (en la zona) al final", () => {
  const meses = lastPeriodsInZone("month", new Date("2026-10-01T02:01:00.000Z"), BA, 6);
  assert.deepEqual(
    meses.map((w) => w.label),
    ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  );
  for (let i = 1; i < meses.length; i++) {
    assert.equal(iso(meses[i].start), iso(meses[i - 1].end), "instantes contiguos");
    assert.equal(iso(meses[i].startDate), iso(meses[i - 1].endDate), "fechas contiguas");
  }

  const dias = lastPeriodsInZone("day", new Date("2026-10-01T02:01:00.000Z"), BA, 30);
  assert.equal(dias.length, 30);
  assert.equal(dias.at(-1)?.label, "2026-09-30");
  assert.equal(dias[0].label, "2026-09-01");
});

test("zona inválida o vacía: cae a UTC en vez de devolver fechas inválidas", () => {
  assert.equal(zonaValidaOUtc("No/Existe"), "UTC");
  assert.equal(zonaValidaOUtc(""), "UTC");
  assert.equal(zonaValidaOUtc(null), "UTC");
  assert.equal(zonaValidaOUtc(BA), BA);
  const w = periodWindowInZone("month", new Date("2026-10-01T02:01:00.000Z"), "No/Existe");
  assert.equal(w.label, "2026-10");
});
