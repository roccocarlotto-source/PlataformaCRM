import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";
import { crearRegla, desmontar, montar, type Escenario } from "../services/automation.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { ACTION_SEND_QR_FOLLOWUP } from "../services/automationActions/sendQrFollowup";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { proximaAperturaDeLaSucursal } from "../services/branchBusinessHours.service";
import { createOpportunity, updateOpportunity } from "../services/opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import { weekdayDesdeIso } from "../utils/workingHours";
import { drenarOutbox } from "./outboxWorker";
import {
  depsDelSeguimientoReales,
  drenarSeguimientosQr,
  type DepsDelSeguimiento,
} from "./qrFollowUpWorker";

// ---------------------------------------------------------------------------
// El seguimiento por WhatsApp con el QR (ítem 159) de punta a punta, contra el
// Postgres del Supabase LOCAL: updateOpportunity a WON -> evento en el outbox
// -> el dispatcher corre la regla -> la acción agenda una fila en
// qr_follow_ups -> el worker la reclama y la manda (a un doble de la Graph
// API, nunca a Meta).
//
// Los registros de acciones y handlers son los del test (mismo criterio que
// automationOpportunityWon.integration-test.ts), y los dos drenados van
// acotados a la organización del test: el runner corre los archivos de
// integración en paralelo contra una base compartida.
// ---------------------------------------------------------------------------

let e: Escenario;
let handlers: RegistroDeHandlers;
let branchId: string;
let qrCodeId: string;
let contactId: string;
// Global UNIQUE en agents: un número al azar por corrida para no chocar con
// otro archivo de la suite.
const PHONE_NUMBER_ID = `9${String(randomInt(100_000_000, 999_999_999))}`;
// La plantilla activa de una REGLA del test (ítem 181: una por regla), en el
// estado que el caso necesite. Borra (soft) la que hubiera: una activa por
// regla. El nombre es único entre las activas de TODA la tabla (WABA
// compartido) y las reglas de los casos anteriores conservan la suya: uno al
// azar por plantilla.
async function plantillaEn(automationId: string, status: "PENDING" | "APPROVED" | "REJECTED") {
  await prisma.whatsappTemplate.updateMany({
    where: { organizationId: e.organizationId, automationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return prisma.whatsappTemplate.create({
    data: {
      organizationId: e.organizationId,
      automationId,
      name: `seguimiento_${String(randomInt(100_000_000, 999_999_999))}`,
      language: "es_AR",
      bodyText: "Hola {nombre}, gracias por tu compra. Tu opinión: {link} ¡Gracias!",
      metaTemplateId: `meta-${String(randomInt(1_000_000, 9_999_999))}`,
      status,
    },
  });
}

before(async () => {
  e = await montar("qr-followup");
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });

  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  branchId = branch.id;
  await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: PHONE_NUMBER_ID,
    },
  });
  const qr = await prisma.qrCode.create({
    data: {
      organizationId: e.organizationId,
      branchId,
      displayNumber: 1,
      name: "Reseñas Google",
      destinationUrl: "https://g.page/r/abc/review",
    },
  });
  qrCodeId = qr.id;
  const contact = await prisma.contact.create({
    data: {
      organizationId: e.organizationId,
      firstName: "Ana",
      lastName: "Pérez",
      phone: "+54 9 11 5555-0000",
    },
  });
  contactId = contact.id;
});

after(async () => {
  if (e) await desmontar(e);
});

function drenarEventos() {
  return drenarOutbox({ organizationId: e.organizationId, registro: handlers });
}

// Un doble de la Graph API: registra lo que se habría mandado y, si el caso lo
// pide, falla con lo que Meta habría contestado.
function doblarEnvio(falla?: unknown) {
  const enviados: SendWhatsappTemplateInput[] = [];
  // F1: el wamid que "devolvió Meta" en cada envío, para encontrar el Message.
  const wamids: string[] = [];
  const deps: DepsDelSeguimiento = {
    accessToken: () => "token-de-prueba",
    // La real: lee la plantilla aprobada de la regla en la base.
    plantillaDeLaRegla: depsDelSeguimientoReales.plantillaDeLaRegla,
    // G-07: siempre abierta; la ventana tiene sus propios casos.
    proximaApertura: (_organizationId, _branchId, ahora) => Promise.resolve(ahora),
    numeroDeLaSucursal: (organizationId, branch) =>
      prisma.agent
        .findFirst({ where: { organizationId, branchId: branch, deletedAt: null } })
        .then((a) => a?.whatsappPhoneNumberId ?? null),
    sendTemplate: (input) => {
      enviados.push(input);
      if (falla !== undefined) return Promise.reject(falla);
      const wamid = `wamid.prueba.${randomUUID()}`;
      wamids.push(wamid);
      return Promise.resolve({ wamid });
    },
  };
  return { deps, enviados, wamids };
}

function drenarSeguimientos(deps: DepsDelSeguimiento) {
  return drenarSeguimientosQr({ organizationId: e.organizationId, deps });
}

async function ganarOportunidad(titulo: string) {
  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: titulo,
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    contactId,
  });
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
  await drenarEventos();
  return opp;
}

function reglaDeQr(delayHours: number) {
  return crearRegla(e, {
    name: `QR a las ${String(delayHours)} h`,
    actionType: ACTION_SEND_QR_FOLLOWUP,
    actionConfig: { qrCodeId, delayHours },
  });
}

function seguimientosDe(opportunityId: string) {
  return prisma.qrFollowUp.findMany({
    where: { organizationId: e.organizationId, opportunityId },
    orderBy: { createdAt: "asc" },
  });
}

// Cada caso trabaja con su propia regla y apaga las de los casos anteriores,
// para que ninguna oportunidad agende filas de otro caso. La regla nace con su
// plantilla APROBADA (el caso normal), salvo que el caso pida lo contrario.
async function soloEstaRegla(delayHours: number, opciones: { sinPlantilla?: boolean } = {}) {
  await prisma.automation.updateMany({
    where: { organizationId: e.organizationId },
    data: { isActive: false },
  });
  const regla = await reglaDeQr(delayHours);
  if (!opciones.sinPlantilla) {
    await plantillaEn(regla.id, "APPROVED");
  }
  return regla;
}

function plantillaActivaDe(automationId: string) {
  return prisma.whatsappTemplate.findFirstOrThrow({
    where: { organizationId: e.organizationId, automationId, deletedAt: null },
  });
}

// ---------------------------------------------------------------------------
// La acción: agenda
// ---------------------------------------------------------------------------

test("ganar la oportunidad agenda UN envío con scheduledFor = ahora + delayHours, sin mandar nada", async () => {
  const regla = await soloEstaRegla(48);
  const antes = Date.now();

  const opp = await ganarOportunidad("Agenda");

  const filas = await seguimientosDe(opp.id);
  assert.equal(filas.length, 1);
  const [fila] = filas;
  assert.equal(fila.automationId, regla.id);
  assert.equal(fila.contactId, contactId);
  assert.equal(fila.qrCodeId, qrCodeId);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0);
  const esperado = antes + 48 * 60 * 60 * 1000;
  assert.ok(
    Math.abs(fila.scheduledFor.getTime() - esperado) < 60_000,
    "scheduledFor ≈ ahora + 48 h",
  );
  assert.equal(fila.nextAttemptAt.getTime(), fila.scheduledFor.getTime());

  // Todavía no venció: el worker no la toma.
  const { deps, enviados } = doblarEnvio();
  const resumen = await drenarSeguimientos(deps);
  assert.equal(resumen.enviados, 0);
  assert.equal(enviados.length, 0);
});

test("la reentrega del evento no agenda otro envío: el UNIQUE lo vuelve un no-op, sin error", async () => {
  await soloEstaRegla(24);
  const opp = await ganarOportunidad("Reentrega");
  assert.equal((await seguimientosDe(opp.id)).length, 1);

  // La ventana del dispatcher: la acción corrió pero su marca SUCCESS se
  // perdió, y el outbox vuelve a entregar el MISMO evento.
  const evento = await prisma.outboxEvent.findFirstOrThrow({
    where: {
      organizationId: e.organizationId,
      payload: { path: ["opportunityId"], equals: opp.id },
    },
  });
  await prisma.automationExecution.deleteMany({ where: { outboxEventId: evento.id } });
  await prisma.outboxEvent.update({
    where: { id: evento.id },
    data: { status: "PENDING", nextAttemptAt: null },
  });

  await drenarEventos();

  assert.equal((await seguimientosDe(opp.id)).length, 1, "sigue habiendo una sola fila");
  const ejecuciones = await prisma.automationExecution.findMany({
    where: { outboxEventId: evento.id },
  });
  assert.deepEqual(
    ejecuciones.map((ejecucion) => ejecucion.status),
    ["SUCCESS"],
    "el duplicado es un éxito, no un fallo",
  );
});

test("dos reglas activas (distintas demoras) agendan una fila cada una", async () => {
  await soloEstaRegla(1);
  await reglaDeQr(72);

  const opp = await ganarOportunidad("Dos reglas");

  const filas = await seguimientosDe(opp.id);
  assert.equal(filas.length, 2);
  const horas = filas
    .map((fila) => Math.round((fila.scheduledFor.getTime() - fila.createdAt.getTime()) / 3_600_000))
    .sort((a, b) => a - b);
  assert.deepEqual(horas, [1, 72]);
});

// ---------------------------------------------------------------------------
// El worker: manda, cancela, reintenta, falla
// ---------------------------------------------------------------------------

test("con delayHours 0 el worker lo manda: plantilla de la regla, número de la sucursal y {{1}}/{{2}}; queda SENT", async () => {
  const regla = await soloEstaRegla(0);
  const plantilla = await plantillaActivaDe(regla.id);
  const opp = await ganarOportunidad("Envío");
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.enviados, 1);
  assert.deepEqual(enviados, [
    {
      phoneNumberId: PHONE_NUMBER_ID,
      to: "5491155550000",
      templateName: plantilla.name,
      languageCode: "es_AR",
      bodyParameters: ["Ana", "https://g.page/r/abc/review"],
      accessToken: "token-de-prueba",
    },
  ]);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "SENT");
  assert.ok(fila.sentAt);
  assert.equal(fila.attempts, 1);
  assert.equal(fila.lastError, null);
});

// ---------------------------------------------------------------------------
// F1 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub): el WhatsApp de la automatización
// queda como saliente en la conversación del contacto, para que el vendedor lo
// vea en la bandeja y el agente lo tenga si el cliente contesta.
// ---------------------------------------------------------------------------

// El agente dueño del número, que es el de la conversación.
function agenteDelNumero() {
  return prisma.agent.findFirstOrThrow({ where: { whatsappPhoneNumberId: PHONE_NUMBER_ID } });
}

// Cierra las conversaciones abiertas que dejaron los casos anteriores (todos
// le mandan al mismo contacto): cada caso de F1 arranca sin hilo abierto.
function cerrarConversacionesDelContacto() {
  return prisma.conversation.updateMany({
    where: { organizationId: e.organizationId, contactId, status: { not: "CLOSED" } },
    data: { status: "CLOSED" },
  });
}

test("F1: el envío queda como saliente del agente en una conversación de WhatsApp nueva, con el texto de la plantilla y el wamid", async () => {
  await cerrarConversacionesDelContacto();
  await soloEstaRegla(0);
  await ganarOportunidad("F1 registro");
  const { deps, wamids } = doblarEnvio();
  const jobsAntes = await prisma.agentInboundJob.count({
    where: { organizationId: e.organizationId },
  });

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.enviados, 1);
  const mensaje = await prisma.message.findFirstOrThrow({
    where: { organizationId: e.organizationId, externalMessageId: wamids[0] },
    include: { conversation: true },
  });
  assert.equal(mensaje.direction, "OUTBOUND");
  // WA-1: remitente "automatización", no el agente.
  assert.equal(mensaje.senderType, "AUTOMATION");
  assert.equal(mensaje.senderUserId, null);
  assert.equal(mensaje.deliveryStatus, "SENT");
  // bodyText de la plantilla del fixture, con {nombre} y {link} reemplazados.
  assert.equal(
    mensaje.content,
    "Hola Ana, gracias por tu compra. Tu opinión: https://g.page/r/abc/review ¡Gracias!",
  );

  const conversacion = mensaje.conversation;
  assert.equal(conversacion.channel, "WHATSAPP");
  assert.equal(conversacion.contactId, contactId);
  assert.equal(conversacion.agentId, (await agenteDelNumero()).id);
  assert.equal(conversacion.branchId, branchId);
  assert.equal(conversacion.externalThreadId, "5491155550000");
  assert.equal(conversacion.status, "ACTIVE");
  assert.equal(conversacion.lastMessageAt?.getTime(), mensaje.createdAt.getTime());

  // Registrar lo que salió no es un mensaje del cliente: no encola ningún turno.
  assert.equal(
    await prisma.agentInboundJob.count({ where: { organizationId: e.organizationId } }),
    jobsAntes,
  );
});

test("F1: con una conversación de WhatsApp abierta, el saliente va a esa y no le cambia el estado", async () => {
  await cerrarConversacionesDelContacto();
  const agente = await agenteDelNumero();
  const abierta = await prisma.conversation.create({
    data: {
      organizationId: e.organizationId,
      branchId,
      agentId: agente.id,
      contactId,
      channel: "WHATSAPP",
      status: "TRANSFERRED_TO_HUMAN",
      assignedUserId: e.userId,
      externalThreadId: "5491155550000",
    },
  });
  await soloEstaRegla(0);
  await ganarOportunidad("F1 hilo abierto");
  const { deps, wamids } = doblarEnvio();

  await drenarSeguimientos(deps);

  const mensaje = await prisma.message.findFirstOrThrow({
    where: { organizationId: e.organizationId, externalMessageId: wamids[0] },
  });
  assert.equal(mensaje.conversationId, abierta.id);
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: abierta.id } });
  assert.equal(despues.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(despues.assignedUserId, e.userId);
  assert.equal(
    await prisma.conversation.count({
      where: { organizationId: e.organizationId, contactId, status: { not: "CLOSED" } },
    }),
    1,
    "no abre otra",
  );
});

test("F1: si anotar en la conversación falla, la fila queda SENT y el envío NUNCA se reintenta", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("F1 registro que falla");
  const primero = doblarEnvio();
  let intentosDeAnotar = 0;
  const resumen = await drenarSeguimientos({
    ...primero.deps,
    registrarEnConversacion: () => {
      intentosDeAnotar++;
      return Promise.reject(new Error("la base se cayó justo acá"));
    },
  });

  assert.equal(resumen.enviados, 1);
  assert.equal(resumen.fallidos + resumen.pospuestos, 0, "no se cuenta como fallo");
  assert.equal(intentosDeAnotar, 1);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "SENT");
  assert.equal(fila.lastError, null);
  assert.equal(await prisma.message.count({ where: { externalMessageId: primero.wamids[0] } }), 0);

  // Aunque su turno siga vencido, no se vuelve a mandar: sería un WhatsApp
  // duplicado al cliente por un problema que es solo nuestro.
  await prisma.qrFollowUp.updateMany({
    where: { opportunityId: opp.id },
    data: { nextAttemptAt: new Date(Date.now() - 60_000) },
  });
  const segundo = doblarEnvio();
  await drenarSeguimientos(segundo.deps);
  assert.equal(segundo.enviados.length, 0);
});

test("un SENT no se reprocesa: la pasada siguiente no manda nada", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Sin reproceso");
  const primero = doblarEnvio();
  await drenarSeguimientos(primero.deps);
  assert.equal(primero.enviados.length, 1);

  // Aunque su turno siga vencido, un SENT no es reclamable.
  await prisma.qrFollowUp.updateMany({
    where: { opportunityId: opp.id },
    data: { nextAttemptAt: new Date(Date.now() - 60_000) },
  });
  const segundo = doblarEnvio();
  const resumen = await drenarSeguimientos(segundo.deps);

  assert.equal(segundo.enviados.length, 0);
  assert.equal(resumen.enviados, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "SENT");
  assert.equal(fila.attempts, 1);
});

test("si la oportunidad dejó de estar ganada antes del envío, CANCELA sin mandar", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Revertida");
  // Vuelve a abierta por el camino de siempre (opportunity.service.ts).
  await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "OPEN" });
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.cancelados, 1);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "CANCELLED");
  assert.match(fila.lastError ?? "", /ya no está ganada \(estado actual: OPEN\)/);
});

test("un 503 de Meta es transitorio: queda PENDING con backoff y el motivo en lastError", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Transitorio");
  const { deps, enviados } = doblarEnvio(new WhatsappGraphError(503, "Service Unavailable"));
  const antes = Date.now();

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.pospuestos, 1);
  assert.equal(enviados.length, 1);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 1);
  assert.ok(fila.nextAttemptAt.getTime() > antes, "el próximo intento es en el futuro");
  assert.match(fila.lastError ?? "", /503/);

  // Su turno no llegó: la pasada siguiente no la toma.
  const otra = doblarEnvio();
  await drenarSeguimientos(otra.deps);
  assert.equal(otra.enviados.length, 0);
});

// G-07 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): con la ventana REAL (proximaAperturaDeLaSucursal) y la sucursal del
// QR cerrada según su horario de atención, el envío se corre a la próxima
// apertura sin mandar nada y SIN gastar el intento.
test("G-07: con la sucursal cerrada según su horario, se corre a la próxima apertura sin mandar ni gastar el intento", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Fuera de horario");
  const [agendada] = await seguimientosDe(opp.id);
  const qr = await prisma.qrCode.findUniqueOrThrow({ where: { id: agendada.qrCodeId } });
  const sucursal = await prisma.branch.findUniqueOrThrow({ where: { id: qr.branchId } });

  // Un solo minuto, pasado mañana en la zona de la sucursal: cerrada ahora.
  const pasadoManiana = DateTime.now().setZone(sucursal.timezone).plus({ days: 2 });
  await prisma.branchBusinessHours.create({
    data: {
      organizationId: e.organizationId,
      branchId: qr.branchId,
      weekday: weekdayDesdeIso(pasadoManiana.weekday),
      startMinute: 0,
      endMinute: 1,
    },
  });
  try {
    const { deps, enviados } = doblarEnvio();
    const conVentanaReal = { ...deps, proximaApertura: proximaAperturaDeLaSucursal };

    const resumen = await drenarSeguimientos(conVentanaReal);

    assert.equal(resumen.fueraDeHorario, 1);
    assert.equal(resumen.enviados, 0);
    assert.equal(enviados.length, 0);
    const [fila] = await seguimientosDe(opp.id);
    assert.equal(fila.status, "PENDING");
    assert.equal(fila.attempts, 0, "esperar a que abra no gasta un intento");
    assert.equal(fila.lastError, null);
    const apertura = pasadoManiana.startOf("day").toJSDate();
    assert.equal(fila.nextAttemptAt.toISOString(), apertura.toISOString());
  } finally {
    await prisma.branchBusinessHours.deleteMany({ where: { organizationId: e.organizationId } });
  }
});

test("un 400 de Meta es permanente: FAILED al primer intento", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Permanente");
  const { deps } = doblarEnvio(new WhatsappGraphError(400, "Template name does not exist"));

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.fallidos, 1);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "FAILED");
  assert.equal(fila.attempts, 1);
  assert.match(fila.lastError ?? "", /Template name does not exist/);
});

test("sin el token no reclama nada: la fila sigue PENDING y sin intentos gastados", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Sin token");
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos({ ...deps, accessToken: () => undefined });

  assert.equal(resumen.sinConfiguracion, true);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0);

  // Con el token, sale en la pasada siguiente.
  const resumen2 = await drenarSeguimientos(deps);
  assert.equal(resumen2.enviados, 1);
});

// ---------------------------------------------------------------------------
// La plantilla de la regla (ítem 160; por regla desde el 181)
// ---------------------------------------------------------------------------

test("con la plantilla PENDING o REJECTED la regla no se reclama: sin intentos gastados, y sale sola al aprobarse", async () => {
  const regla = await soloEstaRegla(0, { sinPlantilla: true });
  await plantillaEn(regla.id, "PENDING");
  const opp = await ganarOportunidad("Plantilla en revisión");
  const { deps, enviados } = doblarEnvio();

  const pendiente = await drenarSeguimientos(deps);
  await plantillaEn(regla.id, "REJECTED");
  const rechazada = await drenarSeguimientos(deps);

  // En silencio: no es "falta configuración" (eso es el token, global).
  assert.equal(pendiente.sinConfiguracion, false);
  assert.equal(pendiente.enviados + pendiente.fallidos + pendiente.pospuestos, 0);
  assert.equal(rechazada.enviados + rechazada.fallidos + rechazada.pospuestos, 0);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0, "no se reclamó: ningún intento gastado");

  // Meta la aprueba: la pasada siguiente la manda, con esa plantilla.
  const aprobadaEnMeta = await plantillaEn(regla.id, "APPROVED");
  const aprobada = await drenarSeguimientos(deps);
  assert.equal(aprobada.enviados, 1);
  assert.equal(enviados[0].templateName, aprobadaEnMeta.name);
});

// El corazón del ítem 181: la organización tiene una plantilla aprobada, pero
// es de OTRA regla (en la vida real, la del cupón). Esa no sirve: su texto
// habla de otra cosa. La fila espera, sin gastar intentos, a que la regla que
// la agendó tenga la suya.
test("la plantilla aprobada de OTRA regla de la misma organización no alcanza: no se reclama, y sale con la propia", async () => {
  const otra = await reglaDeQr(0);
  const deOtra = await plantillaEn(otra.id, "APPROVED");
  // Apaga a `otra`: la oportunidad solo agenda con la regla del caso.
  const regla = await soloEstaRegla(0, { sinPlantilla: true });
  const opp = await ganarOportunidad("Plantilla de otra regla");
  const { deps, enviados } = doblarEnvio();

  const sinLaPropia = await drenarSeguimientos(deps);

  assert.equal(sinLaPropia.enviados + sinLaPropia.fallidos + sinLaPropia.pospuestos, 0);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.automationId, regla.id);
  assert.equal(fila.attempts, 0, "no se reclamó: ningún intento gastado");

  const propia = await plantillaEn(regla.id, "APPROVED");
  const conLaPropia = await drenarSeguimientos(deps);

  assert.equal(conLaPropia.enviados, 1);
  assert.equal(enviados[0].templateName, propia.name);
  assert.notEqual(enviados[0].templateName, deOtra.name);
});

test("una plantilla BORRADA no cuenta aunque haya estado aprobada", async () => {
  const regla = await soloEstaRegla(0);
  const opp = await ganarOportunidad("Plantilla borrada");
  await prisma.whatsappTemplate.updateMany({
    where: { organizationId: e.organizationId, automationId: regla.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  const { deps, enviados } = doblarEnvio();

  await drenarSeguimientos(deps);

  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.attempts, 0);
});

test("si la plantilla se borra entre el reclamo y el envío: FAILED con el motivo, sin mandar", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Borrada a mitad");
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos({
    ...deps,
    // El negocio la borra justo después de que el worker reclamó la fila.
    plantillaDeLaRegla: async (organizationId, automationId) => {
      await prisma.whatsappTemplate.updateMany({
        where: { organizationId, automationId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return deps.plantillaDeLaRegla(organizationId, automationId);
    },
  });

  assert.equal(resumen.fallidos, 1);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "FAILED");
  assert.equal(fila.attempts, 1);
  assert.match(fila.lastError ?? "", /ya no tiene una plantilla de WhatsApp aprobada/);
});
