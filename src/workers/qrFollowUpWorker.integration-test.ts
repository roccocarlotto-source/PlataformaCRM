import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { crearRegla, desmontar, montar, type Escenario } from "../services/automation.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { ACTION_SEND_QR_FOLLOWUP } from "../services/automationActions/sendQrFollowup";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { createOpportunity, updateOpportunity } from "../services/opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import { drenarOutbox } from "./outboxWorker";
import { drenarSeguimientosQr, type DepsDelSeguimiento } from "./qrFollowUpWorker";

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
  const deps: DepsDelSeguimiento = {
    accessToken: () => "token-de-prueba",
    plantilla: () => ({ name: "seguimiento_resena", languageCode: "es_AR" }),
    numeroDeLaSucursal: (organizationId, branch) =>
      prisma.agent
        .findFirst({ where: { organizationId, branchId: branch, deletedAt: null } })
        .then((a) => a?.whatsappPhoneNumberId ?? null),
    sendTemplate: (input) => {
      enviados.push(input);
      return falla === undefined ? Promise.resolve() : Promise.reject(falla);
    },
  };
  return { deps, enviados };
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
// para que ninguna oportunidad agende filas de otro caso.
async function soloEstaRegla(delayHours: number) {
  await prisma.automation.updateMany({
    where: { organizationId: e.organizationId },
    data: { isActive: false },
  });
  return reglaDeQr(delayHours);
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

test("con delayHours 0 el worker lo manda: plantilla, número de la sucursal y {{1}}/{{2}}; queda SENT", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Envío");
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos(deps);

  assert.equal(resumen.enviados, 1);
  assert.deepEqual(enviados, [
    {
      phoneNumberId: PHONE_NUMBER_ID,
      to: "5491155550000",
      templateName: "seguimiento_resena",
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

test("sin la plantilla configurada no reclama nada: la fila sigue PENDING y sin intentos gastados", async () => {
  await soloEstaRegla(0);
  const opp = await ganarOportunidad("Sin configuración");
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenarSeguimientos({
    ...deps,
    plantilla: () => ({ name: undefined, languageCode: undefined }),
  });

  assert.equal(resumen.sinConfiguracion, true);
  assert.equal(enviados.length, 0);
  const [fila] = await seguimientosDe(opp.id);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0);

  // Configurada, sale en la pasada siguiente.
  const resumen2 = await drenarSeguimientos(deps);
  assert.equal(resumen2.enviados, 1);
});
