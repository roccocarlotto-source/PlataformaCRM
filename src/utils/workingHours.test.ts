import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encontrarFranjasSuperpuestas,
  estaContenido,
  estaDentroDelHorario,
  expandirFranjas,
  horaLocalDesdeMinutos,
  minutosDesdeHoraLocal,
  seSuperponen,
  weekdayDesdeIso,
  type FranjaSemanal,
} from "./workingHours";

// Unitarios, sin base y sin red. Acá vive TODA la aritmética del módulo de
// agenda — la parte donde un error de una hora o de un día produce turnos a la
// hora equivocada sin ningún síntoma visible.
//
// Los tests de horario de verano son la razón por la que entró Luxon: fijan qué
// hace el sistema en el salto y en el solapamiento, para que sea una decisión
// verificada y no una casualidad de la implementación.

const BA = "America/Argentina/Buenos_Aires"; // sin horario de verano desde 2009
const SANTIAGO = "America/Santiago"; // con horario de verano, hemisferio sur
const NUEVA_YORK = "America/New_York"; // con horario de verano, hemisferio norte

function iso(fecha: Date): string {
  return fecha.toISOString();
}

// ---------------------------------------------------------------------------
// El mapeo de días — el bug de "quedó corrido un día"
// ---------------------------------------------------------------------------

test("weekdayDesdeIso usa la convención ISO: 1 = lunes, 7 = domingo", () => {
  // NO la de Date.getDay(), donde 0 = domingo. Tener las dos convenciones
  // circulando es el origen del horario corrido un día.
  assert.equal(weekdayDesdeIso(1), "MONDAY");
  assert.equal(weekdayDesdeIso(3), "WEDNESDAY");
  assert.equal(weekdayDesdeIso(7), "SUNDAY");
});

test("weekdayDesdeIso lanza fuera de rango en vez de devolver undefined", () => {
  assert.throws(() => weekdayDesdeIso(0));
  assert.throws(() => weekdayDesdeIso(8));
});

// ---------------------------------------------------------------------------
// Superposición — el detalle que decide si dos turnos consecutivos se pueden
// ---------------------------------------------------------------------------

test("dos turnos CONSECUTIVOS no se superponen (el fin es exclusivo)", () => {
  // Si esto fallara, el sistema rechazaría agendar 9:30 después de un turno
  // 9:00-9:30 — o sea, no se podría trabajar de corrido.
  const a = { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T12:30:00Z") };
  const b = { inicio: new Date("2026-09-07T12:30:00Z"), fin: new Date("2026-09-07T13:00:00Z") };

  assert.equal(seSuperponen(a, b), false);
  assert.equal(seSuperponen(b, a), false);
});

test("dos turnos que se pisan PARCIALMENTE sí se superponen", () => {
  // El caso que el prompt marca explícitamente: no alcanza con comparar horarios
  // idénticos, dos turnos que se pisan compiten por el mismo recurso.
  const a = { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T13:00:00Z") };
  const b = { inicio: new Date("2026-09-07T12:30:00Z"), fin: new Date("2026-09-07T13:30:00Z") };

  assert.equal(seSuperponen(a, b), true);
  assert.equal(seSuperponen(b, a), true, "la relación es simétrica");
});

test("un turno CONTENIDO en otro se superpone", () => {
  const largo = { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T14:00:00Z") };
  const corto = { inicio: new Date("2026-09-07T12:30:00Z"), fin: new Date("2026-09-07T13:00:00Z") };

  assert.equal(seSuperponen(largo, corto), true);
  assert.equal(seSuperponen(corto, largo), true);
});

test("dos turnos disjuntos no se superponen", () => {
  const a = { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T13:00:00Z") };
  const b = { inicio: new Date("2026-09-07T15:00:00Z"), fin: new Date("2026-09-07T16:00:00Z") };

  assert.equal(seSuperponen(a, b), false);
});

test("estaContenido acepta los bordes exactos", () => {
  const franja = {
    inicio: new Date("2026-09-07T12:00:00Z"),
    fin: new Date("2026-09-07T16:00:00Z"),
  };

  assert.equal(estaContenido({ ...franja }, franja), true, "un intervalo se contiene a sí mismo");
  assert.equal(
    estaContenido(
      { inicio: new Date("2026-09-07T11:59:00Z"), fin: new Date("2026-09-07T13:00:00Z") },
      franja,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// El horario partido — el motivo por el que hay varias filas por día
// ---------------------------------------------------------------------------

test("un turno NO puede cruzar el hueco entre dos franjas del mismo día", () => {
  // Recurso que trabaja 9-13 y 16-20. Un turno de 12:30 a 16:30 tiene las dos
  // puntas en horario y en el medio el recurso no está. Tiene que rechazarse.
  //
  // Es la diferencia entre "contenido en ALGUNA franja" y "contenido en la
  // unión de las franjas", y es todo el punto del horario partido.
  const franjas = [
    { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T16:00:00Z") },
    { inicio: new Date("2026-09-07T19:00:00Z"), fin: new Date("2026-09-07T23:00:00Z") },
  ];

  const aCaballo = {
    inicio: new Date("2026-09-07T15:30:00Z"),
    fin: new Date("2026-09-07T19:30:00Z"),
  };
  assert.equal(estaDentroDelHorario(aCaballo, franjas), false);

  const enLaPrimera = {
    inicio: new Date("2026-09-07T12:30:00Z"),
    fin: new Date("2026-09-07T13:00:00Z"),
  };
  assert.equal(estaDentroDelHorario(enLaPrimera, franjas), true);

  const enLaSegunda = {
    inicio: new Date("2026-09-07T22:00:00Z"),
    fin: new Date("2026-09-07T23:00:00Z"),
  };
  assert.equal(estaDentroDelHorario(enLaSegunda, franjas), true);
});

test("sin franjas, nada está dentro del horario", () => {
  const turno = { inicio: new Date("2026-09-07T12:00:00Z"), fin: new Date("2026-09-07T13:00:00Z") };
  assert.equal(estaDentroDelHorario(turno, []), false);
});

// ---------------------------------------------------------------------------
// Expansión de franjas a instantes
// ---------------------------------------------------------------------------

const LUNES_9_A_13: FranjaSemanal = { weekday: "MONDAY", startMinute: 540, endMinute: 780 };
const LUNES_16_A_20: FranjaSemanal = { weekday: "MONDAY", startMinute: 960, endMinute: 1200 };

test("una franja semanal se convierte al instante UTC correcto de la zona", () => {
  // Lunes 7 de septiembre de 2026, Buenos Aires (UTC-3, sin DST).
  // 9:00 local = 12:00Z, 13:00 local = 16:00Z.
  const intervalos = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-09-07T00:00:00Z"),
    hasta: new Date("2026-09-08T00:00:00Z"),
  });

  assert.equal(intervalos.length, 1);
  assert.equal(iso(intervalos[0].inicio), "2026-09-07T12:00:00.000Z");
  assert.equal(iso(intervalos[0].fin), "2026-09-07T16:00:00.000Z");
});

test("dos franjas del mismo día producen dos intervalos, ordenados", () => {
  const intervalos = expandirFranjas({
    franjas: [LUNES_16_A_20, LUNES_9_A_13], // a propósito en orden inverso
    zona: BA,
    desde: new Date("2026-09-07T00:00:00Z"),
    hasta: new Date("2026-09-08T00:00:00Z"),
  });

  assert.equal(intervalos.length, 2);
  assert.equal(iso(intervalos[0].inicio), "2026-09-07T12:00:00.000Z");
  assert.equal(iso(intervalos[1].inicio), "2026-09-07T19:00:00.000Z");
});

test("una franja semanal se repite en cada semana del rango", () => {
  const intervalos = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-09-07T00:00:00Z"),
    hasta: new Date("2026-09-22T00:00:00Z"), // tres lunes: 7, 14, 21
  });

  assert.equal(intervalos.length, 3);
  assert.deepEqual(
    intervalos.map((i) => iso(i.inicio)),
    ["2026-09-07T12:00:00.000Z", "2026-09-14T12:00:00.000Z", "2026-09-21T12:00:00.000Z"],
  );
});

test("los días sin franja no aportan nada", () => {
  const intervalos = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-09-08T00:00:00Z"), // martes
    hasta: new Date("2026-09-13T00:00:00Z"), // hasta el domingo
  });

  assert.deepEqual(intervalos, []);
});

test("las franjas se RECORTAN al rango pedido", () => {
  // Se pide desde el lunes a las 11 local (14:00Z). La franja 9-13 tiene que
  // aportar 11-13, no 9-13: si no, la disponibilidad ofrecería horarios que ya
  // pasaron.
  const intervalos = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-09-07T14:00:00Z"),
    hasta: new Date("2026-09-07T15:00:00Z"),
  });

  assert.equal(intervalos.length, 1);
  assert.equal(iso(intervalos[0].inicio), "2026-09-07T14:00:00.000Z");
  assert.equal(iso(intervalos[0].fin), "2026-09-07T15:00:00.000Z");
});

test("una franja que queda enteramente fuera del rango no aparece", () => {
  const intervalos = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-09-07T17:00:00Z"), // 14 local, ya cerró
    hasta: new Date("2026-09-07T18:00:00Z"),
  });

  assert.deepEqual(intervalos, []);
});

test("una franja que cierra a las 24:00 llega hasta la medianoche siguiente", () => {
  const nocturna: FranjaSemanal = { weekday: "MONDAY", startMinute: 1320, endMinute: 1440 };

  const intervalos = expandirFranjas({
    franjas: [nocturna],
    zona: BA,
    desde: new Date("2026-09-07T00:00:00Z"),
    hasta: new Date("2026-09-09T00:00:00Z"),
  });

  assert.equal(intervalos.length, 1);
  assert.equal(iso(intervalos[0].inicio), "2026-09-08T01:00:00.000Z", "lunes 22:00 local");
  assert.equal(iso(intervalos[0].fin), "2026-09-08T03:00:00.000Z", "martes 00:00 local");
});

test("sin franjas o con un rango invertido devuelve vacío en vez de explotar", () => {
  assert.deepEqual(
    expandirFranjas({
      franjas: [],
      zona: BA,
      desde: new Date("2026-09-07T00:00:00Z"),
      hasta: new Date("2026-09-08T00:00:00Z"),
    }),
    [],
  );

  assert.deepEqual(
    expandirFranjas({
      franjas: [LUNES_9_A_13],
      zona: BA,
      desde: new Date("2026-09-08T00:00:00Z"),
      hasta: new Date("2026-09-07T00:00:00Z"),
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// EL DÍA DE LA SEMANA ES EL DE LA SUCURSAL, NO EL DE UTC
// ---------------------------------------------------------------------------

test("una franja de lunes temprano se ubica por el día LOCAL, no por el UTC", () => {
  // Lunes 7/9 a las 00:30 en Buenos Aires es 03:30Z del lunes — mismo día. Pero
  // el domingo 6/9 a las 23:00 local ya es LUNES 03:00Z en UTC. Si la expansión
  // recorriera días UTC, una franja de domingo terminaría contada como lunes.
  const domingoNoche: FranjaSemanal = { weekday: "SUNDAY", startMinute: 1380, endMinute: 1440 };

  const intervalos = expandirFranjas({
    franjas: [domingoNoche],
    zona: BA,
    desde: new Date("2026-09-06T00:00:00Z"),
    hasta: new Date("2026-09-08T00:00:00Z"),
  });

  assert.equal(intervalos.length, 1);
  // Domingo 6/9 23:00 local = lunes 7/9 02:00Z. El instante cae en lunes UTC y
  // aun así la franja es la de DOMINGO, que es lo correcto.
  assert.equal(iso(intervalos[0].inicio), "2026-09-07T02:00:00.000Z");
  assert.equal(iso(intervalos[0].fin), "2026-09-07T03:00:00.000Z");
});

// ---------------------------------------------------------------------------
// HORARIO DE VERANO — la razón por la que entró Luxon
// ---------------------------------------------------------------------------

test("la MISMA hora local produce distinto UTC antes y después del cambio de hora", () => {
  // Nueva York: el 8/3/2026 arranca el horario de verano (EST -5 -> EDT -4).
  // "Los lunes a las 9" es 14:00Z en invierno y 13:00Z en verano.
  //
  // ES EL TEST CENTRAL DE TODO ESTE ARCHIVO: si la conversión ignorara el
  // horario de verano, la mitad del año los turnos saldrían una hora corridos y
  // nada lo diría.
  const franjas = [LUNES_9_A_13];

  const enInvierno = expandirFranjas({
    franjas,
    zona: NUEVA_YORK,
    desde: new Date("2026-03-02T00:00:00Z"),
    hasta: new Date("2026-03-03T00:00:00Z"),
  });

  const enVerano = expandirFranjas({
    franjas,
    zona: NUEVA_YORK,
    desde: new Date("2026-03-09T00:00:00Z"),
    hasta: new Date("2026-03-10T00:00:00Z"),
  });

  assert.equal(iso(enInvierno[0].inicio), "2026-03-02T14:00:00.000Z", "EST = UTC-5");
  assert.equal(iso(enVerano[0].inicio), "2026-03-09T13:00:00.000Z", "EDT = UTC-4");
});

test("en Santiago (hemisferio sur) el cambio de hora también se refleja", () => {
  // Chile mueve el reloj en septiembre (invierno -> verano austral).
  const franjas = [LUNES_9_A_13];

  const antes = expandirFranjas({
    franjas,
    zona: SANTIAGO,
    desde: new Date("2026-08-31T00:00:00Z"),
    hasta: new Date("2026-09-01T00:00:00Z"),
  });

  const despues = expandirFranjas({
    franjas,
    zona: SANTIAGO,
    desde: new Date("2026-09-14T00:00:00Z"),
    hasta: new Date("2026-09-15T00:00:00Z"),
  });

  assert.equal(antes.length, 1);
  assert.equal(despues.length, 1);

  // Lo que se afirma no es un offset concreto (la fecha del cambio la fija Chile
  // por decreto y puede moverse): es que las 9 locales de un lunes y las de otro
  // NO son la misma hora UTC. Eso solo puede pasar si la zona se está aplicando.
  const horaUtcAntes = antes[0].inicio.getUTCHours();
  const horaUtcDespues = despues[0].inicio.getUTCHours();

  assert.notEqual(
    horaUtcAntes,
    horaUtcDespues,
    "si fueran iguales, el horario de verano no se estaría aplicando",
  );
});

test("una zona SIN horario de verano da el mismo UTC todo el año", () => {
  // El contrapunto del test de arriba: Buenos Aires no cambia desde 2009, así
  // que acá la hora UTC tiene que ser estable. Sirve para que los dos tests
  // anteriores no puedan pasar por una conversión rota que devuelva cualquier
  // cosa distinta.
  const enero = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-01-05T00:00:00Z"),
    hasta: new Date("2026-01-06T00:00:00Z"),
  });

  const julio = expandirFranjas({
    franjas: [LUNES_9_A_13],
    zona: BA,
    desde: new Date("2026-07-06T00:00:00Z"),
    hasta: new Date("2026-07-07T00:00:00Z"),
  });

  assert.equal(enero[0].inicio.getUTCHours(), 12);
  assert.equal(julio[0].inicio.getUTCHours(), 12);
});

test("el día del SALTO de primavera, una hora local inexistente no rompe la expansión", () => {
  // Nueva York, 8/3/2026: a las 02:00 el reloj salta a las 03:00, así que las
  // 02:30 locales NO EXISTEN. Una franja de domingo 2:00 a 4:00 atraviesa el
  // salto.
  //
  // Lo que se fija acá no es una hora exacta —la decisión es de Luxon— sino que
  // el sistema NO produce un intervalo inválido: sigue habiendo un intervalo,
  // con inicio antes que fin, y de una hora MENOS de lo que dice el reloj de
  // pared, que es lo correcto: ese día esa franja dura efectivamente una hora
  // menos.
  const franja: FranjaSemanal = { weekday: "SUNDAY", startMinute: 120, endMinute: 240 };

  const intervalos = expandirFranjas({
    franjas: [franja],
    zona: NUEVA_YORK,
    desde: new Date("2026-03-08T00:00:00Z"),
    hasta: new Date("2026-03-09T12:00:00Z"),
  });

  assert.equal(intervalos.length, 1);

  const duracionMin = (intervalos[0].fin.getTime() - intervalos[0].inicio.getTime()) / (60 * 1000);

  assert.ok(intervalos[0].inicio < intervalos[0].fin, "el intervalo tiene que ser válido");
  assert.equal(duracionMin, 60, "de 2 a 4 con el salto en el medio son 60 minutos reales");
});

test("el día del RETROCESO de otoño, la franja dura una hora MÁS", () => {
  // Nueva York, 1/11/2026: a las 02:00 el reloj vuelve a la 01:00, así que la
  // 01:30 ocurre dos veces. Una franja de domingo 1:00 a 3:00 dura tres horas
  // reales ese día.
  const franja: FranjaSemanal = { weekday: "SUNDAY", startMinute: 60, endMinute: 180 };

  const intervalos = expandirFranjas({
    franjas: [franja],
    zona: NUEVA_YORK,
    desde: new Date("2026-11-01T00:00:00Z"),
    hasta: new Date("2026-11-02T12:00:00Z"),
  });

  assert.equal(intervalos.length, 1);

  const duracionMin = (intervalos[0].fin.getTime() - intervalos[0].inicio.getTime()) / (60 * 1000);

  assert.equal(duracionMin, 180, "de 1 a 3 con el reloj volviendo atrás son 180 minutos reales");
});

// ---------------------------------------------------------------------------
// Validación de un horario semanal
// ---------------------------------------------------------------------------

test("detecta dos franjas superpuestas del mismo día", () => {
  const superpuesta = encontrarFranjasSuperpuestas([
    { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
    { weekday: "MONDAY", startMinute: 720, endMinute: 1200 },
  ]);

  assert.ok(superpuesta, "9-13 y 12-20 se pisan");
  assert.equal(superpuesta.startMinute, 720);
});

test("franjas ADYACENTES no son superposición", () => {
  // 9-13 y 13-20 es un horario corrido cargado en dos filas. Es válido: el fin
  // es exclusivo.
  assert.equal(
    encontrarFranjasSuperpuestas([
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
      { weekday: "MONDAY", startMinute: 780, endMinute: 1200 },
    ]),
    undefined,
  );
});

test("dos franjas iguales en DÍAS distintos no son superposición", () => {
  assert.equal(
    encontrarFranjasSuperpuestas([
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
      { weekday: "TUESDAY", startMinute: 540, endMinute: 780 },
    ]),
    undefined,
  );
});

test("el horario partido normal no dispara falsos positivos", () => {
  assert.equal(encontrarFranjasSuperpuestas([LUNES_9_A_13, LUNES_16_A_20]), undefined);
});

// ---------------------------------------------------------------------------
// "HH:MM" <-> minutos
// ---------------------------------------------------------------------------

test('"HH:MM" se convierte a minutos desde la medianoche', () => {
  assert.equal(minutosDesdeHoraLocal("00:00"), 0);
  assert.equal(minutosDesdeHoraLocal("09:00"), 540);
  assert.equal(minutosDesdeHoraLocal("13:30"), 810);
  assert.equal(minutosDesdeHoraLocal("23:59"), 1439);
});

test('"24:00" es válido (cierre a medianoche) y "24:30" no', () => {
  assert.equal(minutosDesdeHoraLocal("24:00"), 1440);
  assert.equal(minutosDesdeHoraLocal("24:30"), undefined);
});

test("una hora mal formada devuelve undefined en vez de un número raro", () => {
  for (const malo of ["", "9:00", "0900", "25:00", "12:60", "ab:cd", "12:0", "-1:00"]) {
    assert.equal(
      minutosDesdeHoraLocal(malo),
      undefined,
      `debería rechazar ${JSON.stringify(malo)}`,
    );
  }
});

test("la conversión de vuelta a HH:MM es exacta y con ceros a la izquierda", () => {
  assert.equal(horaLocalDesdeMinutos(0), "00:00");
  assert.equal(horaLocalDesdeMinutos(540), "09:00");
  assert.equal(horaLocalDesdeMinutos(1439), "23:59");
  assert.equal(horaLocalDesdeMinutos(1440), "24:00");
});

test("HH:MM -> minutos -> HH:MM es la identidad", () => {
  for (let m = 0; m <= 1440; m += 7) {
    assert.equal(minutosDesdeHoraLocal(horaLocalDesdeMinutos(m)), m);
  }
});
