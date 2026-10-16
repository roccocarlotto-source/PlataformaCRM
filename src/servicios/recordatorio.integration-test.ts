import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { accionCrearActividadDeSeguimiento } from "../services/automationActions/createFollowUpActivity";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { despacharAutomatizaciones } from "../services/automationDispatch.service";
import { createAutomation } from "../services/automation.service";
import { eventoAEntregar } from "../services/automation.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import { WhatsappGraphError } from "../services/whatsappGraph.service";
import { accionRecordatorioDelService } from "./recordatorio/accion";
import { barrerProximosServices } from "./recordatorio/barrido";
import {
  ACTION_SEND_NEXT_SERVICE_REMINDER,
  MOTIVO_FECHA_CAMBIO,
  MOTIVO_ORDEN_ABIERTA,
  MOTIVO_SIN_MARKETING,
  MOTIVO_SIN_WHATSAPP,
  TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
  TRIGGER_NEXT_SERVICE_DUE,
} from "./recordatorio/config";
import { drenarMensajesDelTaller, type DepsDelEnvio } from "./recordatorio/worker";
import { limpiarMensajesDelTallerDelContacto } from "./recordatorio/repository";

// ---------------------------------------------------------------------------
// S7 de docs/servicios.md (§6.2–§6.5): el recordatorio del próximo service
// contra la base real.
//
//   - El barrido registra el aviso y emite el evento una sola vez por (regla,
//     vehículo, fecha), solo desde las 10:00 de la organización, solo con el
//     módulo, y respeta las exclusiones (no recordar, sin interés, orden
//     abierta).
//   - El evento es DIRIGIDO: corre solo la regla que lo produjo.
//   - La acción encola un mensaje por aviso; el worker lo manda con los
//     parámetros de la plantilla, o lo cancela al revalidar; sin WhatsApp (y
//     con el marketing apagado) cancela y crea la tarea.
//   - La tarea va al encargado de la última orden del vehículo.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let sinModulo: OrgDePrueba;
let sucursal: string;

// "Hoy" fijo y lejos de cualquier borde: 14/01/2030, 13:30 en Montevideo.
const AHORA = new Date("2030-01-14T16:30:00.000Z");
const ANTES_DE_LAS_10 = new Date("2030-01-14T12:30:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function regla(
  org: OrgDePrueba,
  offsetDays: number,
  actionType = ACTION_SEND_NEXT_SERVICE_REMINDER,
  actionConfig: Record<string, unknown> = { messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE },
) {
  return prisma.automation.create({
    data: {
      organizationId: org.id,
      name: `Próximo service ${String(offsetDays)}`,
      triggerType: TRIGGER_NEXT_SERVICE_DUE,
      triggerConfig: { offsetDays },
      actionType,
      actionConfig: actionConfig as object,
    },
  });
}

async function cliente(org: OrgDePrueba, extra: Record<string, unknown> = {}) {
  return prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Laura",
      lastName: "Prueba",
      phone: "+59899000123",
      ...extra,
    },
  });
}

let patentes = 0;

async function vehiculo(
  org: OrgDePrueba,
  contactId: string,
  nextServiceDueOn: Date,
  extra: Record<string, unknown> = {},
) {
  return prisma.customerVehicle.create({
    data: {
      organizationId: org.id,
      contactId,
      branchId: sucursal,
      make: "Volkswagen",
      model: "Gol",
      // Una matrícula distinta por vehículo (única por organización); el primero
      // de cada test es ABC 1234.
      licensePlate: `ABC ${String(1234 + patentes)}`,
      licensePlateNorm: `ABC${String(1234 + patentes++)}`,
      nextServiceDueOn,
      ...extra,
    },
  });
}

async function limpiar(org: OrgDePrueba) {
  const where = { organizationId: org.id };
  await prisma.activity.deleteMany({ where });
  await prisma.serviceMessage.deleteMany({ where });
  await prisma.customerVehicleNotice.deleteMany({ where });
  await prisma.automationExecution.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.serviceOrder.deleteMany({ where });
  await prisma.customerVehicle.deleteMany({ where });
  await prisma.automation.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
}

before(async () => {
  taller = await crearOrgDePrueba("servicios-recordatorio", "COMPLETA", "AUTOMOTORA", 1);
  sinModulo = await crearOrgDePrueba("servicios-recordatorio", "COMPLETA", "AUTOMOTORA", 1);
  for (const org of [taller, sinModulo]) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { timezone: "America/Montevideo", name: "Automotores del Sur" },
    });
  }
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  sucursal = (await createBranch(taller.id, { name: "Centro", timezone: "America/Montevideo" })).id;
});

beforeEach(async () => {
  patentes = 0;
  for (const org of [taller, sinModulo]) await limpiar(org);
});

after(async () => {
  for (const org of [taller, sinModulo]) {
    if (!org) continue;
    await limpiar(org);
    await borrarOrgDePrueba(org);
  }
});

test("barrido: un aviso y un evento por vehículo y fecha, con las exclusiones, una sola vez", async () => {
  const r = await regla(taller, -7);
  const laura = await cliente(taller);
  // En la ventana (−7: services del 14/01 al 21/01).
  const enVentana = await vehiculo(taller, laura.id, dia("2030-01-18"));
  // Fuera de la ventana.
  await vehiculo(taller, laura.id, dia("2030-02-20"));
  // Excluidos: no recordar, sin interés, con orden abierta.
  await vehiculo(taller, laura.id, dia("2030-01-18"), { remindersOptOut: true });
  const sinInteres = await cliente(taller, { noInterestAt: new Date() });
  await vehiculo(taller, sinInteres.id, dia("2030-01-18"));
  const conOrden = await vehiculo(taller, laura.id, dia("2030-01-18"));
  await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: 1,
      customerVehicleId: conOrden.id,
      contactId: laura.id,
      branchId: sucursal,
      scheduledFor: new Date("2030-01-17T12:00:00Z"),
      createdById: taller.authIds[0],
    },
  });

  // Antes de las 10:00 de Montevideo, nada.
  assert.equal((await barrerProximosServices({ ahora: ANTES_DE_LAS_10 })).avisos, 0);

  const primera = await barrerProximosServices({ ahora: AHORA, organizationId: taller.id });
  assert.equal(primera.avisos, 1);
  const avisos = await prisma.customerVehicleNotice.findMany({
    where: { organizationId: taller.id },
  });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].customerVehicleId, enVentana.id);
  assert.equal(avisos[0].automationId, r.id);
  assert.equal(avisos[0].dueOn.toISOString(), dia("2030-01-18").toISOString());
  const eventos = await prisma.outboxEvent.findMany({
    where: { organizationId: taller.id, eventType: TRIGGER_NEXT_SERVICE_DUE },
  });
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].payload, {
    automationId: r.id,
    noticeId: avisos[0].id,
    customerVehicleId: enVentana.id,
    contactId: laura.id,
    branchId: sucursal,
    nextServiceDueOn: "2030-01-18",
  });

  // La segunda pasada (la de la hora siguiente, o la de mañana) no repite.
  assert.equal(
    (await barrerProximosServices({ ahora: AHORA, organizationId: taller.id })).avisos,
    0,
  );
  const manana = new Date(AHORA.getTime() + 24 * 3600 * 1000);
  assert.equal(
    (await barrerProximosServices({ ahora: manana, organizationId: taller.id })).avisos,
    0,
  );
});

test("barrido: una organización sin el módulo no recibe avisos aunque tenga la regla", async () => {
  await regla(sinModulo, -7);
  const laura = await cliente(sinModulo);
  await prisma.customerVehicle.create({
    data: {
      organizationId: sinModulo.id,
      contactId: laura.id,
      make: "Volkswagen",
      model: "Gol",
      nextServiceDueOn: dia("2030-01-18"),
    },
  });
  assert.equal(
    (await barrerProximosServices({ ahora: AHORA, organizationId: sinModulo.id })).avisos,
    0,
  );
  assert.equal(
    await prisma.customerVehicleNotice.count({ where: { organizationId: sinModulo.id } }),
    0,
  );
});

/** Barre, y despacha los eventos con las acciones reales. */
async function barrerYDespachar() {
  await barrerProximosServices({ ahora: AHORA, organizationId: taller.id });
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionRecordatorioDelService);
  registro.registrar(accionCrearActividadDeSeguimiento);
  const eventos = await prisma.outboxEvent.findMany({
    where: { organizationId: taller.id, eventType: TRIGGER_NEXT_SERVICE_DUE },
  });
  for (const e of eventos) {
    await despacharAutomatizaciones(eventoAEntregar(e), TRIGGER_NEXT_SERVICE_DUE, { registro });
  }
  return eventos;
}

test("el evento es dirigido: corre solo la regla que lo produjo", async () => {
  // Dos reglas: la de 7 días antes avisa este vehículo; la de 30 días después
  // no (su ventana es otra). Las dos con la acción de WhatsApp.
  const antes = await regla(taller, -7);
  const despues = await regla(taller, 30);
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-18"));
  await barrerYDespachar();
  const mensajes = await prisma.serviceMessage.findMany({ where: { organizationId: taller.id } });
  assert.equal(mensajes.length, 1);
  assert.equal(mensajes[0].automationId, antes.id);
  const ejecuciones = await prisma.automationExecution.findMany({
    where: { organizationId: taller.id },
  });
  assert.deepEqual(
    ejecuciones.map((x) => x.automationId),
    [antes.id],
    "la regla de 30 días después no corrió",
  );
  assert.ok(!ejecuciones.some((x) => x.automationId === despues.id));
});

// Deps del envío con el WhatsApp simulado.
function depsDePrueba(opciones: { falla?: unknown } = {}) {
  const enviados: { to: string; templateName: string; bodyParameters: string[] }[] = [];
  const deps: DepsDelEnvio = {
    accessToken: () => "token-de-prueba",
    plantillaDeLaRegla: () =>
      Promise.resolve({
        name: "proximo_service_prueba",
        languageCode: "es_AR",
        bodyText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
      }),
    numeroDeLaSucursal: () => Promise.resolve("phone-number-id"),
    numeroDeLaOrganizacion: () => Promise.resolve(null),
    sucursales: () => Promise.resolve(1),
    sendTemplate: (input) => {
      if (opciones.falla) return Promise.reject(opciones.falla);
      enviados.push({
        to: input.to,
        templateName: input.templateName,
        bodyParameters: input.bodyParameters,
      });
      return Promise.resolve({ wamid: "wamid.prueba" });
    },
    registrarEnConversacion: () => Promise.resolve(),
    proximaApertura: (_o, _b, ahora) => Promise.resolve(ahora),
  };
  return { deps, enviados };
}

test("envío: sale con la plantilla de la regla y sus cuatro parámetros", async () => {
  await regla(taller, -7);
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-18"));
  await barrerYDespachar();
  const { deps, enviados } = depsDePrueba();
  const r = await drenarMensajesDelTaller({ ahora: AHORA, organizationId: taller.id, deps });
  assert.equal(r.enviados, 1);
  assert.deepEqual(enviados, [
    {
      to: "59899000123",
      templateName: "proximo_service_prueba",
      bodyParameters: [
        "Laura",
        "Automotores del Sur",
        "Volkswagen Gol (ABC 1234)",
        "el 18 de enero",
      ],
    },
  ]);
  const m = await prisma.serviceMessage.findFirstOrThrow({ where: { organizationId: taller.id } });
  assert.equal(m.status, "SENT");
  assert.equal(m.externalMessageId, "wamid.prueba");
  // Una reentrega del evento no encola otro (un mensaje vigente por aviso).
  await barrerYDespachar();
  assert.equal(await prisma.serviceMessage.count({ where: { organizationId: taller.id } }), 1);
});

test("revalidación: la fecha cambió o hay una orden abierta, se cancela con el motivo", async () => {
  await regla(taller, -7);
  const laura = await cliente(taller);
  const cambia = await vehiculo(taller, laura.id, dia("2030-01-18"));
  const agenda = await vehiculo(taller, laura.id, dia("2030-01-19"), {
    licensePlate: "XYZ 9999",
    licensePlateNorm: "XYZ9999",
  });
  await barrerYDespachar();
  await prisma.customerVehicle.update({
    where: { id: cambia.id },
    data: { nextServiceDueOn: dia("2030-07-18") },
  });
  await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: 2,
      customerVehicleId: agenda.id,
      contactId: laura.id,
      branchId: sucursal,
      scheduledFor: new Date("2030-01-17T12:00:00Z"),
      createdById: taller.authIds[0],
    },
  });
  const { deps, enviados } = depsDePrueba();
  const r = await drenarMensajesDelTaller({ ahora: AHORA, organizationId: taller.id, deps });
  assert.equal(r.cancelados, 2);
  assert.equal(enviados.length, 0);
  const motivos = (
    await prisma.serviceMessage.findMany({ where: { organizationId: taller.id } })
  ).map((m) => [m.customerVehicleId, m.status, m.cancelReason]);
  assert.deepEqual(
    motivos.sort(),
    [
      [cambia.id, "CANCELLED", MOTIVO_FECHA_CAMBIO],
      [agenda.id, "CANCELLED", MOTIVO_ORDEN_ABIERTA],
    ].sort(),
  );
});

test("sin WhatsApp y con el marketing apagado: se cancela y va la tarea al encargado de la última orden", async () => {
  await regla(taller, -7);
  const sinTelefono = await cliente(taller, { phone: null, firstName: "Ana" });
  const v1 = await vehiculo(taller, sinTelefono.id, dia("2030-01-18"));
  // La última orden (entregada) del vehículo tiene encargado: a él va la tarea.
  await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: 3,
      customerVehicleId: v1.id,
      contactId: sinTelefono.id,
      branchId: sucursal,
      status: "ENTREGADO",
      deliveredAt: new Date("2029-07-18T12:00:00Z"),
      assigneeId: taller.authIds[0],
      createdById: taller.authIds[0],
    },
  });
  await barrerYDespachar();
  const { deps } = depsDePrueba();
  const r = await drenarMensajesDelTaller({ ahora: AHORA, organizationId: taller.id, deps });
  assert.equal(r.sinWhatsapp, 1);
  assert.equal(r.tareas, 1);
  const m = await prisma.serviceMessage.findFirstOrThrow({ where: { organizationId: taller.id } });
  assert.equal(m.status, "CANCELLED");
  assert.equal(m.cancelReason, MOTIVO_SIN_WHATSAPP);
  const tarea = await prisma.activity.findFirstOrThrow({
    where: { organizationId: taller.id, sourceNoticeId: m.noticeId },
  });
  assert.equal(tarea.assigneeId, taller.authIds[0]);
  assert.equal(tarea.contactId, sinTelefono.id);
  assert.match(tarea.subject, /^Llamar a Ana Prueba por el service de su Volkswagen Gol/);
  // No nace vencida: vence al final del día de la organización (Montevideo),
  // no en el instante en que empezó la pasada.
  assert.equal(tarea.dueDate?.toISOString(), "2030-01-15T02:59:59.999Z");
  assert.ok(tarea.dueDate! > tarea.createdAt);

  // El marketing apagado (131050) es lo mismo.
  await limpiar(taller);
  await regla(taller, -7);
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-18"));
  await barrerYDespachar();
  const apagado = depsDePrueba({
    falla: new WhatsappGraphError(
      400,
      JSON.stringify({ error: { code: 131050, message: "User stopped marketing" } }),
    ),
  });
  const r2 = await drenarMensajesDelTaller({
    ahora: AHORA,
    organizationId: taller.id,
    deps: apagado.deps,
  });
  assert.equal(r2.sinWhatsapp, 1);
  const m2 = await prisma.serviceMessage.findFirstOrThrow({ where: { organizationId: taller.id } });
  assert.equal(m2.cancelReason, MOTIVO_SIN_MARKETING);
  assert.equal(await prisma.activity.count({ where: { sourceNoticeId: m2.noticeId } }), 1);
});

test("sin la casilla, no va la tarea; fuera de horario se pospone sin gastar el intento", async () => {
  await regla(taller, -7, ACTION_SEND_NEXT_SERVICE_REMINDER, {
    messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
    tareaSiNoTieneWhatsapp: false,
  });
  const sinTelefono = await cliente(taller, { phone: null });
  await vehiculo(taller, sinTelefono.id, dia("2030-01-18"));
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-19"));
  await barrerYDespachar();

  const cerrado = depsDePrueba();
  const abre = new Date(AHORA.getTime() + 3 * 3600 * 1000);
  cerrado.deps.proximaApertura = () => Promise.resolve(abre);
  const r = await drenarMensajesDelTaller({
    ahora: AHORA,
    organizationId: taller.id,
    deps: cerrado.deps,
  });
  assert.equal(r.pospuestos, 2);
  for (const m of await prisma.serviceMessage.findMany({ where: { organizationId: taller.id } })) {
    assert.equal(m.status, "PENDING");
    assert.equal(m.attempts, 0, "posponer no gasta el intento");
    assert.equal(m.nextAttemptAt.toISOString(), abre.toISOString());
  }

  const abierto = depsDePrueba();
  const r2 = await drenarMensajesDelTaller({
    ahora: abre,
    organizationId: taller.id,
    deps: abierto.deps,
  });
  assert.equal(r2.enviados, 1);
  assert.equal(r2.sinWhatsapp, 1);
  assert.equal(r2.tareas, 0);
  assert.equal(await prisma.activity.count({ where: { organizationId: taller.id } }), 0);
});

test("la acción Crear tarea con este trigger: una tarea por aviso, aunque el evento se reentregue", async () => {
  await regla(taller, -7, "activity.create_follow_up", {
    subject: "Llamar por el service",
    daysUntilDue: 1,
  });
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-18"));
  const [evento] = await barrerYDespachar();
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionCrearActividadDeSeguimiento);
  // Reentrega forzada: borra la marca de éxito y despacha de nuevo.
  await prisma.automationExecution.deleteMany({ where: { organizationId: taller.id } });
  await despacharAutomatizaciones(eventoAEntregar(evento), TRIGGER_NEXT_SERVICE_DUE, { registro });
  const tareas = await prisma.activity.findMany({ where: { organizationId: taller.id } });
  assert.equal(tareas.length, 1);
  assert.match(tareas[0].subject, /^Llamar por el service — Volkswagen Gol \(ABC \d+\)$/);
  assert.equal(tareas[0].contactId, laura.id);
  assert.ok(tareas[0].sourceNoticeId);
});

test("borrar los datos del cliente cancela sus recordatorios pendientes y limpia last_error", async () => {
  await regla(taller, -7);
  const laura = await cliente(taller);
  await vehiculo(taller, laura.id, dia("2030-01-18"));
  await barrerYDespachar();
  await prisma.serviceMessage.updateMany({
    where: { organizationId: taller.id },
    data: { lastError: "Error de Meta con el +59899000123" },
  });
  await limpiarMensajesDelTallerDelContacto(taller.id, laura.id);
  const m = await prisma.serviceMessage.findFirstOrThrow({ where: { organizationId: taller.id } });
  assert.equal(m.status, "CANCELLED");
  assert.equal(m.lastError, null);
});

test("la regla se crea por el servicio con el módulo: el trigger y la acción del taller pasan sus schemas", async () => {
  const registro = crearRegistroDeAcciones();
  registro.registrar(accionRecordatorioDelService);
  const creada = await createAutomation(
    taller.id,
    {
      name: "Próximo service 7 días antes",
      triggerType: TRIGGER_NEXT_SERVICE_DUE,
      triggerConfig: { offsetDays: -7 },
      actionType: ACTION_SEND_NEXT_SERVICE_REMINDER,
      actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE },
    },
    { registro },
  );
  assert.deepEqual(creada.triggerConfig, { offsetDays: -7 });
  assert.deepEqual(creada.actionConfig, {
    messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
    tareaSiNoTieneWhatsapp: true,
  });
  await assert.rejects(
    createAutomation(
      taller.id,
      {
        name: "Sin días",
        triggerType: TRIGGER_NEXT_SERVICE_DUE,
        triggerConfig: {},
        actionType: ACTION_SEND_NEXT_SERVICE_REMINDER,
        actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE },
      },
      { registro },
    ),
    /offsetDays/,
  );
});
