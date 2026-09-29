import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { agendarDiscountVoucherFollowUp } from "../repositories/discountVoucherFollowUp.repository";
import { crearRegla, desmontar, montar, type Escenario } from "../services/automation.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { ACTION_SEND_DISCOUNT_VOUCHER } from "../services/automationActions/sendDiscountVoucherFollowup";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { getDiscountVoucherPublicState } from "../services/discountVoucher.service";
import { createOpportunity, updateOpportunity } from "../services/opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import {
  WhatsappGraphError,
  type SendWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import { buildVoucherPublicUrl } from "../utils/voucherPublicUrl";
import {
  depsDelCuponReales,
  drenarCupones,
  emitirCuponReal,
  type DepsDelCupon,
} from "./discountVoucherFollowUpWorker";
import { drenarOutbox } from "./outboxWorker";

// ---------------------------------------------------------------------------
// El cupón de descuento por WhatsApp (ítem 177) de punta a punta, contra el
// Postgres del Supabase LOCAL: updateOpportunity a WON -> evento en el outbox
// -> el dispatcher corre la regla -> la acción agenda una fila en
// discount_voucher_follow_ups -> el worker la reclama, EMITE el cupón y lo
// manda (a un doble de la Graph API, nunca a Meta). Mismo armado que
// qrFollowUpWorker.integration-test.ts, con dos organizaciones para el
// aislamiento.
// ---------------------------------------------------------------------------

const DIA_MS = 24 * 60 * 60 * 1000;

interface Org {
  e: Escenario;
  branchId: string;
  contactId: string;
  phoneNumberId: string;
}

let a: Org;
let b: Org;
let handlers: RegistroDeHandlers;

function alAzar() {
  return String(randomInt(100_000_000, 999_999_999));
}

// Una organización lista para mandar: sucursal con un agente con número de
// WhatsApp y un contacto con teléfono. La plantilla aprobada ya no es de la
// organización sino de cada regla (ítem 181): la siembra soloEstaRegla. El
// número es único en TODA la tabla: uno al azar por corrida.
async function prepararOrg(etiqueta: string): Promise<Org> {
  const e = await montar(etiqueta);
  const phoneNumberId = `9${alAzar()}`;
  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId: branch.id,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: phoneNumberId,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: e.organizationId,
      firstName: "Ana",
      lastName: "Pérez",
      phone: "+54 9 11 5555-0000",
    },
  });
  return { e, branchId: branch.id, contactId: contact.id, phoneNumberId };
}

before(async () => {
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });
  a = await prepararOrg("cupon-a");
  b = await prepararOrg("cupon-b");
});

after(async () => {
  const escenarios = [a, b].filter(Boolean).map((org) => org.e);
  if (escenarios.length > 0) await desmontar(...escenarios);
});

// Un doble de la Graph API y del token; la plantilla, el número de la sucursal
// y la EMISIÓN del cupón son los reales, contra la base. El link lo arma
// buildVoucherPublicUrl con QR_PUBLIC_BASE_URL (ítem 178), sin doble.
function doblarEnvio(opciones: { falla?: unknown; accessToken?: string | undefined } = {}) {
  const enviados: SendWhatsappTemplateInput[] = [];
  const deps: DepsDelCupon = {
    ...depsDelCuponReales,
    accessToken: () => ("accessToken" in opciones ? opciones.accessToken : "token-de-prueba"),
    sendTemplate: (input) => {
      enviados.push(input);
      return opciones.falla === undefined
        ? Promise.resolve({ wamid: `wamid.prueba.${randomUUID()}` })
        : Promise.reject(opciones.falla);
    },
  };
  return { deps, enviados };
}

function drenar(org: Org, deps: DepsDelCupon) {
  return drenarCupones({ organizationId: org.e.organizationId, deps });
}

async function ganarOportunidad(org: Org, titulo: string) {
  const opp = await createOpportunity(org.e.organizationId, org.e.userId, {
    title: titulo,
    pipelineId: org.e.pipelineId,
    stageId: org.e.stageId,
    contactId: org.contactId,
  });
  await updateOpportunity(org.e.organizationId, org.e.userId, opp.id, { status: "WON" });
  await drenarOutbox({ organizationId: org.e.organizationId, registro: handlers });
  return opp;
}

// La plantilla APROBADA de una regla (ítem 181: una por regla). El nombre es
// único entre las activas de TODA la tabla: uno al azar por plantilla.
function plantillaAprobada(org: Org, automationId: string) {
  return prisma.whatsappTemplate.create({
    data: {
      organizationId: org.e.organizationId,
      automationId,
      name: `cupon_${alAzar()}`,
      language: "es_AR",
      bodyText: "Hola {nombre}, gracias por tu compra. Tu cupón: {link} ¡Gracias!",
      metaTemplateId: `meta-${alAzar()}`,
      status: "APPROVED",
    },
  });
}

function plantillaActivaDe(org: Org, automationId: string) {
  return prisma.whatsappTemplate.findFirstOrThrow({
    where: { organizationId: org.e.organizationId, automationId, deletedAt: null },
  });
}

// Cada caso trabaja con su propia regla y apaga las anteriores de la org. La
// regla nace con su plantilla aprobada, salvo que el caso pida lo contrario.
async function soloEstaRegla(
  org: Org,
  config: { delayHours: number; expiresInDays?: number; branchId?: string },
  opciones: { sinPlantilla?: boolean } = {},
) {
  await prisma.automation.updateMany({
    where: { organizationId: org.e.organizationId },
    data: { isActive: false },
  });
  const regla = await reglaDeCupon(org, config);
  if (!opciones.sinPlantilla) {
    await plantillaAprobada(org, regla.id);
  }
  return regla;
}

function reglaDeCupon(
  org: Org,
  config: { delayHours: number; expiresInDays?: number; branchId?: string },
) {
  return crearRegla(org.e, {
    name: `Cupón a las ${String(config.delayHours)} h`,
    actionType: ACTION_SEND_DISCOUNT_VOUCHER,
    actionConfig: {
      label: "15% de descuento en el taller",
      delayHours: config.delayHours,
      expiresInDays: config.expiresInDays ?? 30,
      branchId: config.branchId ?? org.branchId,
    },
  });
}

function filasDe(org: Org, opportunityId: string) {
  return prisma.discountVoucherFollowUp.findMany({
    where: { organizationId: org.e.organizationId, opportunityId },
    orderBy: { createdAt: "asc" },
  });
}

function cuponesDe(org: Org, opportunityId: string) {
  return prisma.discountVoucher.findMany({
    where: { organizationId: org.e.organizationId, opportunityId },
  });
}

// ---------------------------------------------------------------------------
// La acción: agenda
// ---------------------------------------------------------------------------

test("ganar la oportunidad agenda UN envío con lo que pidió la regla, sin emitir cupón ni mandar nada", async () => {
  const regla = await soloEstaRegla(a, { delayHours: 48, expiresInDays: 15 });
  const antes = Date.now();

  const opp = await ganarOportunidad(a, "Agenda");

  const filas = await filasDe(a, opp.id);
  assert.equal(filas.length, 1);
  const [fila] = filas;
  assert.equal(fila.automationId, regla.id);
  assert.equal(fila.contactId, a.contactId);
  assert.equal(fila.branchId, a.branchId);
  assert.equal(fila.label, "15% de descuento en el taller");
  assert.equal(fila.expiresInDays, 15);
  assert.equal(fila.discountVoucherId, null);
  assert.equal(fila.status, "PENDING");
  assert.ok(Math.abs(fila.scheduledFor.getTime() - (antes + 48 * 3_600_000)) < 60_000);
  assert.equal(fila.nextAttemptAt.getTime(), fila.scheduledFor.getTime());

  const { deps, enviados } = doblarEnvio();
  const resumen = await drenar(a, deps);
  assert.equal(resumen.enviados, 0);
  assert.equal(enviados.length, 0);
  assert.equal((await cuponesDe(a, opp.id)).length, 0, "el cupón nace al mandar, no al agendar");
});

test("ON CONFLICT DO NOTHING: agendar dos veces la misma (regla, oportunidad) deja UNA fila", async () => {
  const regla = await soloEstaRegla(a, { delayHours: 24 });
  const opp = await ganarOportunidad(a, "Idempotencia directa");
  assert.equal((await filasDe(a, opp.id)).length, 1);

  const otraVez = await agendarDiscountVoucherFollowUp({
    organizationId: a.e.organizationId,
    automationId: regla.id,
    opportunityId: opp.id,
    contactId: a.contactId,
    branchId: a.branchId,
    label: "otro texto",
    expiresInDays: 99,
    scheduledFor: new Date(),
  });

  assert.equal(otraVez, false);
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.label, "15% de descuento en el taller", "no pisó la fila existente");
});

test("la reentrega del evento no agenda otro cupón: la ejecución queda en SUCCESS", async () => {
  await soloEstaRegla(a, { delayHours: 24 });
  const opp = await ganarOportunidad(a, "Reentrega");

  const evento = await prisma.outboxEvent.findFirstOrThrow({
    where: {
      organizationId: a.e.organizationId,
      payload: { path: ["opportunityId"], equals: opp.id },
    },
  });
  await prisma.automationExecution.deleteMany({ where: { outboxEventId: evento.id } });
  await prisma.outboxEvent.update({
    where: { id: evento.id },
    data: { status: "PENDING", nextAttemptAt: null },
  });
  await drenarOutbox({ organizationId: a.e.organizationId, registro: handlers });

  assert.equal((await filasDe(a, opp.id)).length, 1);
  const ejecuciones = await prisma.automationExecution.findMany({
    where: { outboxEventId: evento.id },
  });
  assert.deepEqual(
    ejecuciones.map((ejecucion) => ejecucion.status),
    ["SUCCESS"],
  );
});

test("una regla con la sucursal de OTRA organización falla la ejecución y no agenda nada", async () => {
  const regla = await soloEstaRegla(a, { delayHours: 0, branchId: b.branchId });

  const opp = await ganarOportunidad(a, "Sucursal ajena");

  assert.equal((await filasDe(a, opp.id)).length, 0);
  const [ejecucion] = await prisma.automationExecution.findMany({
    where: { automationId: regla.id },
  });
  assert.equal(ejecucion.status, "FAILED");
  assert.match(ejecucion.error ?? "", /no existe o está borrada: editá la automatización/);
});

// ---------------------------------------------------------------------------
// El worker de punta a punta
// ---------------------------------------------------------------------------

test("con delayHours 0: emite UN cupón, lo anota en la fila y manda {{1}} nombre y {{2}} el link; queda SENT", async () => {
  const regla = await soloEstaRegla(a, { delayHours: 0, expiresInDays: 30 });
  const plantilla = await plantillaActivaDe(a, regla.id);
  const opp = await ganarOportunidad(a, "Envío");
  const { deps, enviados } = doblarEnvio();
  const antes = Date.now();

  const resumen = await drenar(a, deps);

  assert.equal(resumen.enviados, 1);
  const cupones = await cuponesDe(a, opp.id);
  assert.equal(cupones.length, 1);
  const [cupon] = cupones;
  assert.equal(cupon.label, "15% de descuento en el taller");
  assert.equal(cupon.contactId, a.contactId);
  assert.equal(cupon.status, "ACTIVE");
  assert.ok(Math.abs(cupon.expiresAt.getTime() - (antes + 30 * DIA_MS)) < 60_000);

  assert.deepEqual(enviados, [
    {
      phoneNumberId: a.phoneNumberId,
      to: "5491155550000",
      templateName: plantilla.name,
      languageCode: "es_AR",
      bodyParameters: ["Ana", buildVoucherPublicUrl(cupon.id)],
      accessToken: "token-de-prueba",
    },
  ]);
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.status, "SENT");
  assert.equal(fila.discountVoucherId, cupon.id);
  assert.equal(fila.lastError, null);

  // El link lleva a un cupón que el GET público ve activo.
  assert.deepEqual(await getDiscountVoucherPublicState(cupon.id), {
    status: "ACTIVE",
    label: "15% de descuento en el taller",
  });

  // F1 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub): el cupón que salió queda como
  // saliente en la conversación de WhatsApp del contacto, con el link real.
  const [anotado] = await prisma.message.findMany({
    where: {
      organizationId: a.e.organizationId,
      content: { contains: buildVoucherPublicUrl(cupon.id) },
    },
    include: { conversation: true },
  });
  assert.ok(anotado, "el envío quedó en la conversación");
  assert.equal(anotado.direction, "OUTBOUND");
  // WA-1: remitente "automatización", no el agente.
  assert.equal(anotado.senderType, "AUTOMATION");
  assert.equal(anotado.deliveryStatus, "SENT");
  assert.match(anotado.externalMessageId ?? "", /^wamid\.prueba\./);
  assert.equal(anotado.conversation.contactId, a.contactId);
  assert.equal(anotado.conversation.channel, "WHATSAPP");
});

test("expiresAt se cuenta desde el ENVÍO, no desde el agendado", async () => {
  await soloEstaRegla(a, { delayHours: 0, expiresInDays: 7 });
  const opp = await ganarOportunidad(a, "Vigencia desde el envío");
  // El agendado fue hace diez días (un envío que se demoró): si la vigencia
  // contara desde ahí, el cupón nacería vencido.
  const haceDiezDias = new Date(Date.now() - 10 * DIA_MS);
  await prisma.discountVoucherFollowUp.updateMany({
    where: { opportunityId: opp.id },
    data: { scheduledFor: haceDiezDias, nextAttemptAt: haceDiezDias },
  });
  const antes = Date.now();

  await drenar(a, doblarEnvio().deps);

  const [cupon] = await cuponesDe(a, opp.id);
  assert.ok(Math.abs(cupon.expiresAt.getTime() - (antes + 7 * DIA_MS)) < 60_000);
  assert.ok(cupon.expiresAt.getTime() > Date.now(), "no nació vencido");
});

test("un 503 de Meta después de emitir: PENDING con backoff, y el reintento manda el MISMO cupón sin emitir otro", async () => {
  await soloEstaRegla(a, { delayHours: 0 });
  const opp = await ganarOportunidad(a, "Reintento");

  const caido = doblarEnvio({ falla: new WhatsappGraphError(503, "Service Unavailable") });
  const primero = await drenar(a, caido.deps);

  assert.equal(primero.pospuestos, 1);
  const cuponesTrasFallo = await cuponesDe(a, opp.id);
  assert.equal(cuponesTrasFallo.length, 1);
  const [filaTrasFallo] = await filasDe(a, opp.id);
  assert.equal(filaTrasFallo.status, "PENDING");
  assert.equal(filaTrasFallo.discountVoucherId, cuponesTrasFallo[0].id);
  assert.match(filaTrasFallo.lastError ?? "", /503/);

  // Llega el turno del reintento.
  await prisma.discountVoucherFollowUp.updateMany({
    where: { opportunityId: opp.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const sano = doblarEnvio();
  const segundo = await drenar(a, sano.deps);

  assert.equal(segundo.enviados, 1);
  const cupones = await cuponesDe(a, opp.id);
  assert.equal(cupones.length, 1, "sigue habiendo un solo cupón");
  assert.equal(sano.enviados[0].bodyParameters[1], buildVoucherPublicUrl(cupones[0].id));
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.status, "SENT");
  assert.equal(fila.attempts, 2);
});

test("si la oportunidad dejó de estar ganada antes del envío: CANCELA sin emitir cupón", async () => {
  await soloEstaRegla(a, { delayHours: 0 });
  const opp = await ganarOportunidad(a, "Revertida");
  await updateOpportunity(a.e.organizationId, a.e.userId, opp.id, { status: "OPEN" });
  const { deps, enviados } = doblarEnvio();

  const resumen = await drenar(a, deps);

  assert.equal(resumen.cancelados, 1);
  assert.equal(enviados.length, 0);
  assert.equal((await cuponesDe(a, opp.id)).length, 0);
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.status, "CANCELLED");
  assert.match(fila.lastError ?? "", /estado actual: OPEN/);
});

test("sin WHATSAPP_ACCESS_TOKEN no reclama nada: PENDING sin intentos gastados, y sale al configurarlo", async () => {
  await soloEstaRegla(a, { delayHours: 0 });
  const opp = await ganarOportunidad(a, "Sin token");

  const sinToken = doblarEnvio({ accessToken: undefined });
  const resumen = await drenar(a, sinToken.deps);

  assert.equal(resumen.sinConfiguracion, true);
  assert.equal(sinToken.enviados.length, 0);
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0);
  assert.equal((await cuponesDe(a, opp.id)).length, 0);

  const resumen2 = await drenar(a, doblarEnvio().deps);
  assert.equal(resumen2.enviados, 1);
});

test("emitirCuponReal con un reclamo que ya no es el dueño de la fila: lanza y NO deja cupón (rollback)", async () => {
  await soloEstaRegla(a, { delayHours: 48 });
  const opp = await ganarOportunidad(a, "Lease perdido");
  const fila = await prisma.discountVoucherFollowUp.findFirstOrThrow({
    where: { opportunityId: opp.id },
    include: {
      automation: { select: { isActive: true, deletedAt: true } },
      opportunity: { select: { status: true, deletedAt: true } },
      contact: { select: { firstName: true, phone: true, deletedAt: true } },
      branch: { select: { deletedAt: true } },
    },
  });

  // attempts 7 no es el de la fila (0): otro worker la habría retomado.
  await assert.rejects(
    emitirCuponReal(
      { id: fila.id, organizationId: fila.organizationId, attempts: 7 },
      fila,
      new Date(Date.now() + DIA_MS),
    ),
    /cambió de dueño/,
  );

  assert.equal((await cuponesDe(a, opp.id)).length, 0, "el INSERT del cupón se deshizo");
  const [despues] = await filasDe(a, opp.id);
  assert.equal(despues.discountVoucherId, null);
});

// ---------------------------------------------------------------------------
// Aislamiento entre organizaciones
// ---------------------------------------------------------------------------

// Ítem 181: la organización tiene una plantilla aprobada, pero es de OTRA
// regla (en la vida real, la del QR de reseñas). El EXISTS del reclamo compara
// automation_id: la fila del cupón espera sin gastar intentos ni emitir nada.
test("la plantilla aprobada de OTRA regla de la organización no alcanza: no reclama ni emite, y sale con la propia", async () => {
  const otra = await reglaDeCupon(a, { delayHours: 0 });
  await plantillaAprobada(a, otra.id);
  const regla = await soloEstaRegla(a, { delayHours: 0 }, { sinPlantilla: true });
  const opp = await ganarOportunidad(a, "Plantilla de otra regla");
  const { deps, enviados } = doblarEnvio();

  const sinLaPropia = await drenar(a, deps);

  assert.equal(sinLaPropia.enviados + sinLaPropia.fallidos + sinLaPropia.pospuestos, 0);
  assert.equal(enviados.length, 0);
  assert.equal((await cuponesDe(a, opp.id)).length, 0);
  const [fila] = await filasDe(a, opp.id);
  assert.equal(fila.automationId, regla.id);
  assert.equal(fila.attempts, 0, "no se reclamó: ningún intento gastado");

  const propia = await plantillaAprobada(a, regla.id);
  const conLaPropia = await drenar(a, deps);

  assert.equal(conLaPropia.enviados, 1);
  assert.equal(enviados[0].templateName, propia.name);
});

test("aislamiento: el drenado de una organización no toca las filas de otra, y cada cupón nace en la suya", async () => {
  await soloEstaRegla(a, { delayHours: 0 });
  const reglaB = await soloEstaRegla(b, { delayHours: 0 });
  const plantillaB = await plantillaActivaDe(b, reglaB.id);
  const oppA = await ganarOportunidad(a, "Aislamiento A");
  const oppB = await ganarOportunidad(b, "Aislamiento B");

  const envioA = doblarEnvio();
  await drenar(a, envioA.deps);

  // La de B sigue intacta.
  const [filaB] = await filasDe(b, oppB.id);
  assert.equal(filaB.status, "PENDING");
  assert.equal(filaB.attempts, 0);
  assert.equal((await cuponesDe(b, oppB.id)).length, 0);
  assert.equal(envioA.enviados.length, 1);
  assert.equal(envioA.enviados[0].phoneNumberId, a.phoneNumberId);

  const envioB = doblarEnvio();
  await drenar(b, envioB.deps);

  const [cuponA] = await cuponesDe(a, oppA.id);
  const [cuponB] = await cuponesDe(b, oppB.id);
  assert.equal(cuponA.organizationId, a.e.organizationId);
  assert.equal(cuponB.organizationId, b.e.organizationId);
  assert.equal(envioB.enviados[0].phoneNumberId, b.phoneNumberId);
  assert.equal(envioB.enviados[0].templateName, plantillaB.name);
  assert.equal(envioB.enviados[0].bodyParameters[1], buildVoucherPublicUrl(cuponB.id));
  // Ninguna fila de una organización apunta a un cupón de la otra.
  const cruzadas = await prisma.discountVoucherFollowUp.count({
    where: {
      organizationId: a.e.organizationId,
      discountVoucherId: cuponB.id,
    },
  });
  assert.equal(cruzadas, 0);
});
