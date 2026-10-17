import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { TRANSICIONES } from "../../servicios/config/estados";
import { fechaDeRecambio, CONFIG_DEL_RECAMBIO_POR_DEFECTO } from "../../servicios/recambio/config";
import {
  CONTACTOS,
  CONVERSACIONES,
  esSlugDeTallerDemo,
  IDENTIDADES_DE_CANAL,
  nombreDeLaDemo,
  OPORTUNIDADES,
  ORDENES,
  PROCESO_DE_VENTA,
  STOCK,
  SUCURSALES,
  TAREAS,
  TURNOS,
  VEHICULOS_DE_CLIENTES,
  ZONA_DE_LA_DEMO,
} from "./config";
import {
  fechasDeLasOportunidades,
  fechasDeLosTurnos,
  fechasDeLosVehiculosDeClientes,
  hoyEnLaDemo,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Los datos de ejemplo del Taller Demo, sin base: que lo que cuenta cada
// pantalla salga igual sea cual sea el día de la carga (fechas relativas a
// hoy, en la zona de la demo), y que la configuración sea coherente consigo
// misma (órdenes con transiciones válidas, un auto por vez en el taller, los
// conteos del Resumen del taller y del Dashboard).
// ---------------------------------------------------------------------------

// Un "ahora" por cada día de la semana, más los bordes de mes (el último día
// a la noche, el primero a la madrugada) y un febrero.
const AHORAS = [
  ...[0, 1, 2, 3, 4, 5, 6].map((d) =>
    DateTime.fromObject(
      { year: 2026, month: 10, day: 12 + d, hour: [8, 23, 0, 12, 19, 9, 23][d], minute: 59 },
      { zone: ZONA_DE_LA_DEMO },
    ),
  ),
  DateTime.fromObject(
    { year: 2026, month: 10, day: 31, hour: 23, minute: 30 },
    { zone: ZONA_DE_LA_DEMO },
  ),
  DateTime.fromObject(
    { year: 2026, month: 11, day: 1, hour: 0, minute: 30 },
    { zone: ZONA_DE_LA_DEMO },
  ),
  DateTime.fromObject({ year: 2026, month: 3, day: 1, hour: 10 }, { zone: ZONA_DE_LA_DEMO }),
  DateTime.fromObject({ year: 2027, month: 2, day: 28, hour: 18 }, { zone: ZONA_DE_LA_DEMO }),
].map((d) => d.toJSDate());

function enLaZona(fecha: Date): DateTime {
  return DateTime.fromJSDate(fecha, { zone: ZONA_DE_LA_DEMO });
}

/** Una fecha calendario (@db.Date, medianoche UTC) como día de la zona. */
function diaCalendario(fecha: Date): DateTime {
  const utc = DateTime.fromJSDate(fecha, { zone: "utc" });
  return DateTime.fromObject(
    { year: utc.year, month: utc.month, day: utc.day },
    { zone: ZONA_DE_LA_DEMO },
  );
}

for (const ahora of AHORAS) {
  const hoy = hoyEnLaDemo(ahora);
  const etiqueta = enLaZona(ahora).toFormat("cccc dd/LL HH:mm");
  const inicioDeMes = hoy.startOf("month");
  const inicioDelMesPasado = inicioDeMes.minus({ months: 1 });

  test(`oportunidades con hoy ${etiqueta}: 7 creadas este mes y 5 el pasado, 2+2 ganadas, 1+2 perdidas`, () => {
    const fechas = fechasDeLasOportunidades(ahora);
    assert.equal(fechas.length, OPORTUNIDADES.length);
    const esteMes = (d: DateTime) => d >= inicioDeMes && d < inicioDeMes.plus({ months: 1 });
    const mesPasado = (d: DateTime) => d >= inicioDelMesPasado && d < inicioDeMes;

    let creadasEsteMes = 0;
    let creadasMesPasado = 0;
    let ganadasEsteMes = 0;
    let ganadasMesPasado = 0;
    let perdidasEsteMes = 0;
    let perdidasMesPasado = 0;
    let montoGanadoEsteMes = 0;
    let montoGanadoMesPasado = 0;
    let abiertas = 0;
    let montoAbierto = 0;
    for (const [i, f] of fechas.entries()) {
      const o = OPORTUNIDADES[i];
      const creada = enLaZona(f.creada);
      assert.ok(f.creada.getTime() <= ahora.getTime(), `${o.titulo}: creada en el futuro`);
      if (esteMes(creada)) creadasEsteMes++;
      if (mesPasado(creada)) creadasMesPasado++;
      const etapa = PROCESO_DE_VENTA.etapas.find((e) => e.clave === o.etapa)!;
      if (!etapa.ganada && !etapa.perdida) {
        assert.equal(f.cerrada, null);
        assert.ok(f.esperada && diaCalendario(f.esperada) > hoy, "cierre esperado en el futuro");
        abiertas++;
        montoAbierto += o.montoUsd;
        continue;
      }
      assert.ok(f.cerrada, `${o.titulo}: cerrada sin fecha`);
      const cerrada = diaCalendario(f.cerrada);
      assert.ok(cerrada <= hoy, `${o.titulo}: cerrada en el futuro`);
      assert.ok(cerrada >= creada.startOf("day"), `${o.titulo}: cerrada antes de creada`);
      if (etapa.ganada) {
        if (esteMes(cerrada)) {
          ganadasEsteMes++;
          montoGanadoEsteMes += o.montoUsd;
        }
        if (mesPasado(cerrada)) {
          ganadasMesPasado++;
          montoGanadoMesPasado += o.montoUsd;
        }
      } else {
        assert.ok(o.motivoDePerdida, `${o.titulo}: perdida sin motivo`);
        if (esteMes(cerrada)) perdidasEsteMes++;
        if (mesPasado(cerrada)) perdidasMesPasado++;
      }
    }
    assert.equal(creadasEsteMes, 7);
    assert.equal(creadasMesPasado, 5);
    assert.equal(ganadasEsteMes, 2);
    assert.equal(ganadasMesPasado, 2);
    assert.equal(montoGanadoEsteMes, 41_500);
    assert.equal(montoGanadoMesPasado, 36_000);
    assert.equal(perdidasEsteMes, 1);
    assert.equal(perdidasMesPasado, 2);
    assert.equal(abiertas, 6);
    assert.equal(montoAbierto, 98_200);
  });

  test(`turnos con hoy ${etiqueta}: la semana que viene, de lunes a viernes, en el horario de Casa Central`, () => {
    const turnos = fechasDeLosTurnos(ahora);
    assert.equal(turnos.length, TURNOS.length);
    const lunes = hoy.startOf("week").plus({ weeks: 1 });
    for (const t of turnos) {
      const inicio = enLaZona(t.inicio);
      assert.ok(t.inicio.getTime() > ahora.getTime(), "un turno en el pasado");
      assert.ok(
        inicio >= lunes && inicio < lunes.plus({ days: 5 }),
        `${inicio.toISO()} fuera de la semana`,
      );
      const minuto = inicio.hour * 60 + inicio.minute;
      const franja = SUCURSALES.central.horario.find(
        (f) => f.weekday === inicio.toFormat("cccc").toUpperCase(),
      );
      assert.ok(franja && minuto >= franja.startMinute && minuto + 60 <= franja.endMinute);
      assert.equal(t.fin.getTime() - t.inicio.getTime(), 60 * 60_000);
    }
  });

  test(`vehículos de clientes con hoy ${etiqueta}: 3 recambios vencidos y 2 próximos, 2 services vencidos y 3 en 30 días, 2 sin fecha de compra`, () => {
    const fechas = fechasDeLosVehiculosDeClientes(ahora);
    assert.equal(fechas.length, VEHICULOS_DE_CLIENTES.length);
    let recambiosVencidos = 0;
    let recambiosProximos = 0;
    let sinFechaDeCompra = 0;
    let servicesVencidos = 0;
    let servicesEn30 = 0;
    const conOrdenAbierta = new Set(
      ORDENES.filter(
        (o) => !["ENTREGADO", "CANCELADO"].includes(o.pasos[o.pasos.length - 1].estado),
      ).map((o) => o.vehiculo),
    );
    for (const [i, f] of fechas.entries()) {
      const v = VEHICULOS_DE_CLIENTES[i];
      const contacto = CONTACTOS[v.contacto];
      if (f.compra === null) {
        sinFechaDeCompra++;
      } else {
        const compra = diaCalendario(f.compra);
        assert.ok(compra <= hoy, `${v.clave}: compra en el futuro`);
        // Lo que mira el módulo de recambios (docs/servicios.md §7): sin
        // interés y con una compra en curso quedan fuera.
        const conCompraEnCurso = OPORTUNIDADES.some(
          (o) =>
            o.contacto === v.contacto &&
            !PROCESO_DE_VENTA.etapas.find((e) => e.clave === o.etapa)!.ganada &&
            !PROCESO_DE_VENTA.etapas.find((e) => e.clave === o.etapa)!.perdida,
        );
        if (!contacto.sinInteres && !conCompraEnCurso) {
          const recambio = diaCalendario(
            fechaDeRecambio(f.compra, CONFIG_DEL_RECAMBIO_POR_DEFECTO),
          );
          const aviso = recambio.minus({ days: CONFIG_DEL_RECAMBIO_POR_DEFECTO.daysBefore });
          const ultimaOportunidad = OPORTUNIDADES.map((o, j) => ({ o, j }))
            .filter(({ o }) => o.contacto === v.contacto)
            .map(({ j }) => enLaZona(fechasDeLasOportunidades(ahora)[j].creada))
            .sort((a, b) => b.toMillis() - a.toMillis())[0];
          if (aviso < hoy.minus({ days: 7 }) && !(ultimaOportunidad && ultimaOportunidad > aviso)) {
            recambiosVencidos++;
          }
          if (recambio >= hoy && recambio <= hoy.plus({ days: 90 })) recambiosProximos++;
        }
      }
      if (f.proximoService !== null && !conOrdenAbierta.has(v.clave)) {
        const service = diaCalendario(f.proximoService);
        if (service < hoy) servicesVencidos++;
        if (service >= hoy && service <= hoy.plus({ days: 30 })) servicesEn30++;
      }
      if (v.venta !== undefined) {
        assert.ok(
          f.compra && f.proximoService,
          `${v.clave}: la venta trae compra y primer service`,
        );
        assert.ok(
          diaCalendario(f.proximoService) > hoy.plus({ days: 30 }),
          "el primer service está lejos",
        );
      }
    }
    assert.equal(recambiosVencidos, 3);
    assert.equal(recambiosProximos, 2);
    assert.equal(sinFechaDeCompra, 2);
    assert.equal(servicesVencidos, 2);
    assert.equal(servicesEn30, 3);
  });
}

test("el slug de la demo: taller-demo y taller-demo-<sufijo>, y nada parecido", () => {
  assert.equal(nombreDeLaDemo(), "Taller Demo");
  assert.equal(nombreDeLaDemo(" Este "), "Taller Demo Este");
  assert.ok(esSlugDeTallerDemo("taller-demo"));
  assert.ok(esSlugDeTallerDemo("taller-demo-este"));
  assert.ok(!esSlugDeTallerDemo("taller-demolicion"));
  assert.ok(!esSlugDeTallerDemo("mi-taller-demo"));
});

test("los contactos son todos distintos e inventados: teléfonos únicos, emails @example.com", () => {
  assert.equal(new Set(CONTACTOS.map((c) => c.telefono)).size, CONTACTOS.length);
  assert.equal(new Set(CONTACTOS.map((c) => c.email)).size, CONTACTOS.length);
  assert.ok(
    CONTACTOS.every((c) => c.email.endsWith("@example.com") && /^\+5989\d{7}$/.test(c.telefono)),
  );
  for (const i of IDENTIDADES_DE_CANAL) {
    const fuente = CONTACTOS[i.contacto].fuente;
    assert.equal(fuente, i.canal === "INSTAGRAM" ? "Instagram" : "Messenger");
  }
  assert.equal(new Set(IDENTIDADES_DE_CANAL.map((i) => i.id)).size, IDENTIDADES_DE_CANAL.length);
  for (const c of CONVERSACIONES) {
    assert.ok(CONTACTOS[c.contacto], "cada conversación tiene su contacto");
    const minutos = c.mensajes.map((m) => m.minuto);
    assert.deepEqual(
      minutos,
      [...minutos].sort((a, b) => a - b),
      "los mensajes van en orden",
    );
  }
  for (const t of TAREAS) {
    if (t.oportunidad !== undefined) {
      assert.equal(OPORTUNIDADES[t.oportunidad].contacto, t.contacto, t.asunto);
    }
  }
});

test("el stock: una reservada, dos vendidas (las ganadas con unidad), el resto disponible y publicado", () => {
  const unidades = Object.entries(STOCK);
  assert.equal(unidades.filter(([, u]) => u.estado === "RESERVED").length, 1);
  assert.equal(unidades.filter(([, u]) => u.estado === "SOLD").length, 2);
  const vinculadas = OPORTUNIDADES.filter((o) => o.unidad);
  for (const o of vinculadas) {
    const etapa = PROCESO_DE_VENTA.etapas.find((e) => e.clave === o.etapa)!;
    assert.equal(STOCK[o.unidad!].estado, etapa.ganada ? "SOLD" : "RESERVED", o.titulo);
    assert.equal(
      STOCK[o.unidad!].precioUsd,
      o.montoUsd,
      `${o.titulo}: el monto es el precio de la unidad`,
    );
  }
  assert.equal(
    new Set(vinculadas.map((o) => o.unidad)).size,
    vinculadas.length,
    "una unidad por oportunidad",
  );
  assert.equal(unidades.filter(([, u]) => u.aConsultar).length, 1);
  assert.equal(unidades.filter(([, u]) => u.soloPesos).length, 1);
});

test("las órdenes: transiciones válidas, cronología hacia atrás, un auto por vez en el taller, 2/2/2/1 y los turnos", () => {
  const enElTaller: string[] = [];
  const porEstado: Record<string, number> = {};
  for (const o of ORDENES) {
    assert.ok(["AGENDADO", "RECIBIDO"].includes(o.pasos[0].estado), "nace Agendada o Recibida");
    if (o.pasos[0].estado === "RECIBIDO") assert.ok(o.pasos[0].km, "Recibida con km");
    for (let i = 1; i < o.pasos.length; i++) {
      const desde = o.pasos[i - 1];
      const hacia = o.pasos[i];
      assert.ok(
        TRANSICIONES[desde.estado].includes(hacia.estado),
        `${o.vehiculo}: ${desde.estado} → ${hacia.estado}`,
      );
      assert.ok(
        hacia.horasAtras < desde.horasAtras,
        `${o.vehiculo}: el historial va hacia adelante`,
      );
      if (desde.estado === "ESPERANDO_APROBACION" && hacia.estado !== "CANCELADO") {
        assert.ok(
          hacia.aprobacion,
          `${o.vehiculo}: salir de Esperando aprobación exige la aprobación`,
        );
      }
      if (hacia.estado === "CANCELADO") assert.ok(hacia.motivo);
      if (hacia.estado === "ENTREGADO") assert.notEqual(hacia.proximoServiceEnDias, undefined);
    }
    const ultimo = o.pasos[o.pasos.length - 1].estado;
    porEstado[ultimo] = (porEstado[ultimo] ?? 0) + 1;
    if (["RECIBIDO", "EN_TRABAJO", "ESPERANDO_APROBACION", "LISTO_PARA_RETIRAR"].includes(ultimo)) {
      enElTaller.push(o.vehiculo);
    }
    assert.ok(
      VEHICULOS_DE_CLIENTES.some((v) => v.clave === o.vehiculo),
      `${o.vehiculo} existe`,
    );
    if (o.turno)
      assert.ok(
        TURNOS.some((t) => t.clave === o.turno),
        `${o.turno} existe`,
      );
    if (o.avisado) assert.equal(ultimo, "LISTO_PARA_RETIRAR");
  }
  assert.equal(
    new Set(enElTaller).size,
    enElTaller.length,
    "un mismo auto no está dos veces en el taller",
  );
  assert.deepEqual(porEstado, {
    ENTREGADO: 1,
    CANCELADO: 1,
    RECIBIDO: 2,
    EN_TRABAJO: 2,
    ESPERANDO_APROBACION: 2,
    LISTO_PARA_RETIRAR: 1,
    AGENDADO: 2,
  });
  // Esperando aprobación hace más de 24 h: exactamente una.
  const esperandoHaceMas = ORDENES.filter((o) => {
    const u = o.pasos[o.pasos.length - 1];
    return u.estado === "ESPERANDO_APROBACION" && u.horasAtras > 24;
  });
  assert.equal(esperandoHaceMas.length, 1);
  // Un turno cancelado, vinculado a una orden Agendada.
  const cancelados = TURNOS.filter((t) => t.cancelado);
  assert.equal(cancelados.length, 1);
  assert.ok(ORDENES.some((o) => o.turno === cancelados[0].clave));
  // El turno de cada orden es del dueño del auto.
  for (const o of ORDENES) {
    if (!o.turno) continue;
    const turno = TURNOS.find((t) => t.clave === o.turno)!;
    const vehiculo = VEHICULOS_DE_CLIENTES.find((v) => v.clave === o.vehiculo)!;
    assert.equal(turno.contacto, vehiculo.contacto);
  }
});

test("las tareas: 3 vencidas, 3 para hoy, 3 para la semana y 2 completadas", () => {
  const pendientes = TAREAS.filter((t) => t.completadaHace === undefined);
  assert.equal(pendientes.filter((t) => t.vence < 0).length, 3);
  assert.equal(pendientes.filter((t) => t.vence === 0).length, 3);
  assert.equal(pendientes.filter((t) => t.vence > 0).length, 3);
  assert.equal(TAREAS.length - pendientes.length, 2);
});
