import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atencionFueraDeHorario,
  describirApertura,
  describirHorario,
  fraseFueraDeHorario,
} from "./fueraDeHorario";
import { HORARIO_POR_DEFECTO } from "./horarioDeAtencion";
import type { FranjaSemanal } from "./workingHours";

// Montevideo es UTC-3 todo el año, así que las horas locales se leen directo.
// 2026-10-05 es lunes; 2026-10-10, sábado; 2026-10-11, domingo.
const MVD = "America/Montevideo";
const local = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);

// El horario "cargado" de los tests: el mismo que el default, pero guardado.
const LUNES_A_SABADO: FranjaSemanal[] = [...HORARIO_POR_DEFECTO];

test("describirHorario: los días seguidos con las mismas franjas van juntos", () => {
  assert.equal(describirHorario(LUNES_A_SABADO), "de lunes a sábado de 9 a 20 h");
  assert.equal(
    describirHorario([
      ...LUNES_A_SABADO.filter((f) => f.weekday !== "SATURDAY"),
      { weekday: "SATURDAY", startMinute: 9 * 60, endMinute: 13 * 60 + 30 },
    ]),
    "de lunes a viernes de 9 a 20 h y los sábados de 9 a 13:30 h",
  );
  assert.equal(
    describirHorario([
      { weekday: "TUESDAY", startMinute: 15 * 60, endMinute: 20 * 60 },
      { weekday: "MONDAY", startMinute: 15 * 60, endMinute: 20 * 60 },
      { weekday: "MONDAY", startMinute: 9 * 60, endMinute: 13 * 60 },
      { weekday: "TUESDAY", startMinute: 9 * 60, endMinute: 13 * 60 },
      { weekday: "THURSDAY", startMinute: 0, endMinute: 24 * 60 },
    ]),
    "lunes y martes de 9 a 13 y de 15 a 20 h y los jueves de 0 a 24 h",
  );
});

test("dentro del horario: null, el mensaje queda como siempre", () => {
  assert.equal(atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-05", "15:30")), null);
  assert.equal(atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-05", "09:00")), null);
});

test("sucursal sin horario cargado: null aunque sean las 3 de la mañana (como antes)", () => {
  assert.equal(atencionFueraDeHorario([], MVD, local("2026-10-05", "03:00")), null);
});

test("de madrugada: hoy a partir de la apertura", () => {
  const atencion = atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-06", "03:00"));
  assert.ok(atencion);
  assert.equal(atencion.cuando, "hoy a partir de las 9");
  assert.equal(atencion.proximaApertura.toISOString(), local("2026-10-06", "09:00").toISOString());
  assert.equal(
    fraseFueraDeHorario(atencion),
    "Nuestro equipo atiende de lunes a sábado de 9 a 20 h. Te vamos a escribir hoy a partir de las 9.",
  );
});

test("después del cierre (fin exclusivo): mañana", () => {
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-05", "20:00"))?.cuando,
    "mañana a partir de las 9",
  );
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-05", "23:59"))?.cuando,
    "mañana a partir de las 9",
  );
});

test("víspera de domingo: el sábado a la noche es 'el lunes', y el domingo es 'mañana'", () => {
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-10", "21:00"))?.cuando,
    "el lunes a partir de las 9",
  );
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, MVD, local("2026-10-11", "12:00"))?.cuando,
    "mañana a partir de las 9",
  );
});

test("zonas horarias distintas: el día y la hora son los de la sucursal", () => {
  // Domingo 11/10 a las 23:30 en Montevideo = lunes 12/10 a las 04:30 en Madrid
  // (UTC+2 en octubre). Mismo instante, dos respuestas distintas.
  const instante = local("2026-10-11", "23:30");
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, MVD, instante)?.cuando,
    "mañana a partir de las 9",
  );
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, "Europe/Madrid", instante)?.cuando,
    "hoy a partir de las 9",
  );
  // Y la apertura es a las 9 de MADRID, no de Montevideo.
  assert.equal(
    atencionFueraDeHorario(
      LUNES_A_SABADO,
      "Europe/Madrid",
      instante,
    )?.proximaApertura.toISOString(),
    "2026-10-12T07:00:00.000Z",
  );
  // A las 15 de Montevideo del lunes son las 20 en Madrid: allá ya cerró.
  assert.equal(
    atencionFueraDeHorario(LUNES_A_SABADO, "Europe/Madrid", local("2026-10-05", "15:00"))?.cuando,
    "mañana a partir de las 9",
  );
});

test("describirApertura: hora con minutos, 'la 1', y a una semana con la fecha", () => {
  const lunes = local("2026-10-05", "10:00");
  assert.equal(
    describirApertura(local("2026-10-06", "09:30"), MVD, lunes),
    "mañana a partir de las 9:30",
  );
  assert.equal(
    describirApertura(local("2026-10-05", "13:00"), MVD, lunes),
    "hoy a partir de las 13",
  );
  assert.equal(
    describirApertura(local("2026-10-06", "01:00"), MVD, lunes),
    "mañana a partir de la 1",
  );
  assert.equal(
    describirApertura(local("2026-10-09", "09:00"), MVD, lunes),
    "el viernes a partir de las 9",
  );
  // Solo abre los lunes y ya cerró: el lunes que viene, con la fecha.
  const soloLunes: FranjaSemanal[] = [{ weekday: "MONDAY", startMinute: 540, endMinute: 600 }];
  assert.equal(
    atencionFueraDeHorario(soloLunes, MVD, lunes)?.cuando,
    "el lunes 12 de octubre a partir de las 9",
  );
});
