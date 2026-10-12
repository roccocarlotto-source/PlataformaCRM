import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import {
  BLOQUEO,
  DIAS_DE_TURNOS,
  esSlugDeClinicaDemo,
  PACIENTES,
  PRESTACIONES,
  PROFESIONALES,
  TURNOS_PROXIMOS,
  ZONA_DE_LA_DEMO,
} from "./config";
import {
  fechasDeLosTurnosAtendidos,
  fechasDeLosTurnosProximos,
  horarioDelBloqueo,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Las fechas de los datos de ejemplo de la Clínica Demo (docs/rubros.md
// §12.2), sin base: relativas a hoy, en la zona de la demo, y válidas para
// los services (horario de cada profesional, grilla de cada prestación, el
// bloqueo, sin superposiciones) empiece la ventana el día que empiece.
// ---------------------------------------------------------------------------

const DIAS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

// Un "ahora" por cada día de la semana (del lunes 2026-10-12 al domingo
// 2026-10-18), a distintas horas, incluida la última hora del día.
const AHORAS = [0, 1, 2, 3, 4, 5, 6].map((d) =>
  DateTime.fromObject(
    { year: 2026, month: 10, day: 12 + d, hour: [8, 23, 0, 12, 19, 9, 23][d], minute: 59 },
    { zone: ZONA_DE_LA_DEMO },
  ).toJSDate(),
);

for (const ahora of AHORAS) {
  const hoy = DateTime.fromJSDate(ahora, { zone: ZONA_DE_LA_DEMO });
  const etiqueta = hoy.toFormat("cccc HH:mm");

  test(`turnos próximos con hoy ${etiqueta}: en los 14 días desde mañana, sin domingos, en el horario y la grilla`, () => {
    const manana = hoy.startOf("day").plus({ days: 1 });
    const fin = manana.plus({ days: DIAS_DE_TURNOS });
    const turnos = fechasDeLosTurnosProximos(ahora);
    assert.equal(turnos.length, TURNOS_PROXIMOS.length);

    const bloqueo = horarioDelBloqueo(ahora);
    for (const { turno, inicio } of turnos) {
      const desde = DateTime.fromJSDate(inicio, { zone: ZONA_DE_LA_DEMO });
      assert.ok(desde >= manana && desde < fin, `${desde.toISO()} fuera de la ventana`);
      assert.notEqual(desde.weekday, 7, "un domingo");
      assert.equal(desde.weekday, turno.dia + 1, "el día de la semana de la lista");
      assert.equal(Math.floor(desde.diff(manana, "days").days / 7), turno.semana, "la tanda");

      // Dentro de una franja del profesional y en la grilla de la prestación.
      const duracion = PRESTACIONES[turno.prestacion].duracionMin;
      const minuto = desde.hour * 60 + desde.minute;
      const franja = PROFESIONALES[turno.profesional].horario.find(
        (f) =>
          f.weekday === DIAS[desde.weekday - 1] &&
          f.startMinute <= minuto &&
          minuto + duracion <= f.endMinute,
      );
      assert.ok(franja, `${turno.profesional} no atiende ${desde.toISO()}`);
      assert.equal((minuto - franja.startMinute) % duracion, 0, "fuera de la grilla");
      assert.ok(PRESTACIONES[turno.prestacion].profesionales.includes(turno.profesional));

      // Ningún turno de la Dra. dentro del bloqueo.
      if (turno.profesional === BLOQUEO.profesional) {
        const finDelTurno = inicio.getTime() + duracion * 60_000;
        assert.ok(
          finDelTurno <= bloqueo.startsAt.getTime() || inicio >= bloqueo.endsAt,
          "un turno de la Dra. dentro del bloqueo",
        );
      }
    }

    // Sin superposiciones del mismo profesional, salvo el sobreturno, que va
    // después del turno que llena su horario.
    const normales = turnos.filter((t) => !t.turno.sobreturno);
    for (const [i, a] of normales.entries()) {
      for (const b of normales.slice(i + 1)) {
        if (a.turno.profesional !== b.turno.profesional) continue;
        const finA = a.inicio.getTime() + PRESTACIONES[a.turno.prestacion].duracionMin * 60_000;
        const finB = b.inicio.getTime() + PRESTACIONES[b.turno.prestacion].duracionMin * 60_000;
        assert.ok(finA <= b.inicio.getTime() || finB <= a.inicio.getTime(), "se superponen");
      }
    }
    const sobreturnos = turnos.filter((t) => t.turno.sobreturno);
    assert.equal(sobreturnos.length, 1);
    const lleno = turnos.findIndex(
      (t) =>
        !t.turno.sobreturno &&
        t.turno.profesional === sobreturnos[0].turno.profesional &&
        t.inicio.getTime() === sobreturnos[0].inicio.getTime(),
    );
    assert.ok(lleno >= 0 && lleno < turnos.indexOf(sobreturnos[0]));

    // El bloqueo: el viernes de la primera tanda, de 13 a 19.
    const inicioDelBloqueo = DateTime.fromJSDate(bloqueo.startsAt, { zone: ZONA_DE_LA_DEMO });
    assert.equal(inicioDelBloqueo.weekday, 5);
    assert.equal(inicioDelBloqueo.hour, 13);
    assert.ok(inicioDelBloqueo >= manana && inicioDelBloqueo < manana.plus({ days: 7 }));
  });

  test(`turnos atendidos con hoy ${etiqueta}: en la semana anterior, ya terminados`, () => {
    const lunes = hoy.startOf("week");
    for (const { inicio } of fechasDeLosTurnosAtendidos(ahora)) {
      assert.ok(inicio < lunes.toJSDate() && inicio >= lunes.minus({ weeks: 1 }).toJSDate());
      assert.ok(inicio < ahora);
    }
  });
}

test("los pacientes: ocho, con emails @example.com, sin teléfono y sin los nombres de fantasía de antes", () => {
  assert.equal(PACIENTES.length, 8);
  for (const p of PACIENTES) {
    assert.match(p.email, /^[a-z]+\.[a-z]+@example\.com$/);
    assert.equal("telefono" in p || "phone" in p, false);
  }
  const apellidos = PACIENTES.map((p) => p.apellido);
  for (const viejo of ["Ficticia", "Inventada", "Supuesta", "Imaginario", "Modelo", "Simulado"]) {
    assert.ok(!apellidos.includes(viejo), viejo);
  }
});

test("esSlugDeClinicaDemo: clinica-demo y clinica-demo-<sufijo>, nada más", () => {
  assert.equal(esSlugDeClinicaDemo("clinica-demo"), true);
  assert.equal(esSlugDeClinicaDemo("clinica-demo-norte"), true);
  assert.equal(esSlugDeClinicaDemo("clinica-demonio"), false);
  assert.equal(esSlugDeClinicaDemo("mi-clinica-demo"), false);
  assert.equal(esSlugDeClinicaDemo("clinica-centro"), false);
});
