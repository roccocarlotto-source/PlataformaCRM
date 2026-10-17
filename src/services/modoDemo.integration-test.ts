import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import type { JobReclamado } from "../repositories/agentInboundJob.repository";
import { enviarPorElCanal, type DepsDeEnvio } from "../workers/agentInboundWorker";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  depsDelSeguimientoReales,
  drenarSeguimientosQr,
  type DepsDelSeguimiento,
} from "../workers/qrFollowUpWorker";
import { asignarNumeroDeWhatsapp } from "./agent.service";
import { crearRegla, desmontar, montar, type Escenario } from "./automation.test-helper";
import { crearRegistroDeAcciones } from "./automationActions";
import { ACTION_SEND_QR_FOLLOWUP } from "./automationActions/sendQrFollowup";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { iniciarConexion as iniciarGoogle } from "./googleCalendarConnection.service";
import { createInvitation, resendInvitation } from "./invitation.service";
import { iniciarConexion as iniciarMeta } from "./metaPageConnection.service";
import {
  MENSAJE_INVITACION_EN_DEMO,
  esIdSimulado,
  esOrganizacionDemo,
  exigirInvitacionPermitidaEnDemo,
  salidasPara,
} from "./modoDemo.service";
import { createOpportunity, updateOpportunity } from "./opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "./outboxHandlers";
import { sendWhatsappTemplateReal } from "./whatsappGraph.service";
import { sincronizarPlantillaDeLaRegla, type DepsDePlantillas } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// Modo demo, de punta a punta (docs-privados/taller-demo-diseno.md §2.4,
// local): con is_demo = true NADA SALE. Cada caso corre el camino real (el
// worker, el service) con las salidas reales reemplazadas por espías que
// LANZAN si se los llama: si la guardia faltara en ese sitio, el test cae con
// "REAL llamada en modo demo". Y el espejo: con is_demo = false el espía sí
// recibe la llamada, que es la garantía de que una organización común no
// cambió.
//
// Dos organizaciones del helper de automatizaciones (slug auto-…): `demo`
// con la bandera puesta a mano (no hay endpoint que la ponga: solo el alta de
// una demo, PR 2), y `comun` sin tocar.
// ---------------------------------------------------------------------------

let demo: Escenario;
let comun: Escenario;
let handlers: RegistroDeHandlers;
let branchId: string;
let agentId: string;
let qrCodeId: string;
let contactId: string;
const PHONE_NUMBER_ID = `9${String(randomInt(100_000_000, 999_999_999))}`;

function explota(nombre: string) {
  return () => Promise.reject(new Error(`${nombre} REAL llamada en modo demo`));
}

before(async () => {
  demo = await montar("modo-demo");
  comun = await montar("modo-demo-comun");
  await prisma.organization.update({ where: { id: demo.organizationId }, data: { isDemo: true } });
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });

  const branch = await prisma.branch.create({
    data: { organizationId: demo.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  branchId = branch.id;
  const agent = await prisma.agent.create({
    data: {
      organizationId: demo.organizationId,
      branchId,
      name: "Asistente de la demo",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: PHONE_NUMBER_ID,
    },
  });
  agentId = agent.id;
  const qr = await prisma.qrCode.create({
    data: {
      organizationId: demo.organizationId,
      branchId,
      displayNumber: 1,
      name: "Reseñas",
      destinationUrl: "https://example.com/resenas",
    },
  });
  qrCodeId = qr.id;
  const contact = await prisma.contact.create({
    data: {
      organizationId: demo.organizationId,
      firstName: "Cliente",
      lastName: "De la demo",
      // Un número inventado que PODRÍA ser de una persona: es exactamente lo
      // que el modo demo tiene que impedir que reciba algo.
      phone: "+598 99 000 000",
    },
  });
  contactId = contact.id;
});

after(async () => {
  if (demo) await desmontar(demo);
  if (comun) await desmontar(comun);
});

// ---------------------------------------------------------------------------
// La bandera y la guardia contra la base
// ---------------------------------------------------------------------------

test("esOrganizacionDemo lee la bandera; salidasPara devuelve el mismo deps a una organización común", async () => {
  assert.equal(await esOrganizacionDemo(demo.organizationId), true);
  assert.equal(await esOrganizacionDemo(comun.organizationId), false);
  assert.equal(
    await esOrganizacionDemo(randomUUID()),
    false,
    "una organización que no existe no es demo",
  );

  const reales = { ...depsDelSeguimientoReales };
  assert.equal(await salidasPara(comun.organizationId, reales), reales);
  const simuladas = await salidasPara(demo.organizationId, reales);
  assert.notEqual(simuladas.sendTemplate, sendWhatsappTemplateReal);
});

// ---------------------------------------------------------------------------
// El agente, por WhatsApp y por Meta (agentInboundWorker.enviarPorElCanal)
// ---------------------------------------------------------------------------

function jobDe(organizationId: string, channel: "WHATSAPP" | "MESSENGER"): JobReclamado {
  return {
    id: randomUUID(),
    organizationId,
    messageId: randomUUID(),
    channel,
    channelAccountId: channel === "WHATSAPP" ? PHONE_NUMBER_ID : "pagina-1",
    externalUserId: channel === "WHATSAPP" ? "59899000000" : "psid-1",
    attempts: 1,
    responseMessageId: null,
    createdAt: new Date(),
  } as JobReclamado;
}

test("el agente en una demo: WhatsApp y Messenger se simulan (wamid demo:, los espías no corren)", async () => {
  const deps: Pick<DepsDeEnvio, "accessToken" | "sendText" | "sendMetaText"> = {
    accessToken: () => "token-de-prueba",
    sendText: explota("sendText"),
    sendMetaText: explota("sendMetaText"),
  };
  const wamid = await enviarPorElCanal(
    jobDe(demo.organizationId, "WHATSAPP"),
    { id: randomUUID(), content: "Hola, tenemos el Onix que buscás." },
    null,
    deps,
  );
  assert.ok(wamid && esIdSimulado(wamid), `wamid simulado: ${String(wamid)}`);
  assert.equal(
    await enviarPorElCanal(
      jobDe(demo.organizationId, "MESSENGER"),
      { id: randomUUID(), content: "Hola por Messenger." },
      "token-de-pagina",
      deps,
    ),
    null,
  );
});

test("sin modo demo, el mismo camino SÍ llama a la salida real (el espejo)", async () => {
  const llamadas: string[] = [];
  const deps: Pick<DepsDeEnvio, "accessToken" | "sendText" | "sendMetaText"> = {
    accessToken: () => "token-de-prueba",
    sendText: (input) => {
      llamadas.push(input.to);
      return Promise.resolve({ wamid: `wamid.${randomUUID()}` });
    },
    sendMetaText: explota("sendMetaText"),
  };
  const wamid = await enviarPorElCanal(
    jobDe(comun.organizationId, "WHATSAPP"),
    { id: randomUUID(), content: "Hola" },
    null,
    deps,
  );
  assert.deepEqual(llamadas, ["59899000000"]);
  assert.ok(wamid?.startsWith("wamid."));
});

// ---------------------------------------------------------------------------
// Una regla con plantilla: la sincronización queda APPROVED sin Meta, y el
// seguimiento por QR se "manda" simulado (qrFollowUpWorker, el camino entero:
// ganar la oportunidad → outbox → agendar → drenar).
// ---------------------------------------------------------------------------

test("la plantilla de una regla de la demo queda APPROVED con id demo: sin llamar a Meta, y el QR sale simulado", async () => {
  await prisma.automation.updateMany({
    where: { organizationId: demo.organizationId },
    data: { isActive: false },
  });
  const regla = await crearRegla(demo, {
    name: "QR al ganar (demo)",
    actionType: ACTION_SEND_QR_FOLLOWUP,
    actionConfig: {
      qrCodeId,
      delayHours: 0,
      messageText: "Hola {nombre}, gracias por tu compra. Tu opinión acá: {link} ¡Gracias!",
    },
  });

  const plantillas: DepsDePlantillas = {
    wabaId: () => "111111111111111",
    accessToken: () => "token-de-la-plataforma",
    appId: () => "app-de-prueba",
    create: explota("createWhatsappTemplate"),
    delete: explota("deleteWhatsappTemplate"),
    getStatus: explota("getWhatsappTemplateStatus"),
    uploadSample: explota("uploadTemplateSample"),
    nombreNuevo: () => `demo_qr_${String(randomInt(100_000_000, 999_999_999))}`,
  };
  const sincronizacion = await sincronizarPlantillaDeLaRegla(
    demo.organizationId,
    { id: regla.id, actionType: regla.actionType, actionConfig: regla.actionConfig },
    plantillas,
  );
  assert.equal(sincronizacion.error ?? null, null, JSON.stringify(sincronizacion));
  const plantilla = await prisma.whatsappTemplate.findFirstOrThrow({
    where: { organizationId: demo.organizationId, automationId: regla.id, deletedAt: null },
  });
  assert.equal(plantilla.status, "APPROVED");
  assert.ok(
    esIdSimulado(plantilla.metaTemplateId),
    `metaTemplateId: ${String(plantilla.metaTemplateId)}`,
  );

  const opp = await createOpportunity(demo.organizationId, demo.userId, {
    title: "Venta de la demo",
    pipelineId: demo.pipelineId,
    stageId: demo.stageId,
    contactId,
  });
  await updateOpportunity(demo.organizationId, demo.userId, opp.id, { status: "WON" });
  await drenarOutbox({ organizationId: demo.organizationId, registro: handlers });

  const deps: DepsDelSeguimiento = {
    accessToken: () => "token-de-prueba",
    plantillaDeLaRegla: depsDelSeguimientoReales.plantillaDeLaRegla,
    proximaApertura: (_organizationId, _branchId, ahora) => Promise.resolve(ahora),
    numeroDeLaSucursal: () => Promise.resolve(PHONE_NUMBER_ID),
    sendTemplate: explota("sendTemplate"),
  };
  const resumen = await drenarSeguimientosQr({ organizationId: demo.organizationId, deps });
  assert.equal(resumen.enviados, 1, JSON.stringify(resumen));
  const fila = await prisma.qrFollowUp.findFirstOrThrow({
    where: { organizationId: demo.organizationId, opportunityId: opp.id },
  });
  assert.equal(fila.status, "SENT");
  // El wamid simulado queda en el mensaje saliente que el drenado registra en
  // la conversación del contacto: es lo que la pantalla marca "Simulado".
  const saliente = await prisma.message.findFirst({
    where: { organizationId: demo.organizationId, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(saliente, "el drenado registró el saliente");
  assert.ok(
    esIdSimulado(saliente.externalMessageId),
    `id externo: ${String(saliente.externalMessageId)}`,
  );
});

// ---------------------------------------------------------------------------
// Lo que conecta algo real: 409
// ---------------------------------------------------------------------------

async function status(fn: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return (err as { statusCode?: number }).statusCode;
  }
}

test("en una demo, conectar Meta o Google y asignarle un número al agente dan 409", async () => {
  assert.equal(
    await status(() => iniciarMeta({ organizationId: demo.organizationId, userId: demo.userId })),
    409,
  );
  assert.equal(await status(() => iniciarGoogle(demo.organizationId, branchId)), 409);
  assert.equal(
    await status(() =>
      asignarNumeroDeWhatsapp({
        agentId,
        whatsappPhoneNumberId: "123456789012345",
        platformAdminUserId: demo.userId,
      }),
    ),
    409,
  );
  const sinCambios = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
  assert.equal(sinCambios.whatsappPhoneNumberId, PHONE_NUMBER_ID, "no tocó el agente");
});

test("en una demo, invitar o reenviar como ADMIN común da 409; un platform admin pasa la guardia", async () => {
  const antes = await prisma.invitation.count({ where: { organizationId: demo.organizationId } });
  await assert.rejects(
    createInvitation(
      demo.organizationId,
      demo.userId,
      { email: `inventado-${randomUUID().slice(0, 8)}@example.com`, role: "USER" },
      "AUTOMOTORA",
    ),
    (err: unknown) =>
      (err as { statusCode?: number; message?: string }).statusCode === 409 &&
      (err as { message?: string }).message === MENSAJE_INVITACION_EN_DEMO,
  );
  assert.equal(await status(() => resendInvitation(demo.organizationId, randomUUID())), 409);
  assert.equal(
    await prisma.invitation.count({ where: { organizationId: demo.organizationId } }),
    antes,
    "no creó ninguna invitación",
  );

  // Un platform admin sí puede: es como el alta de la demo crea sus usuarios.
  await prisma.platformAdmin.create({ data: { userId: demo.userId } });
  try {
    await exigirInvitacionPermitidaEnDemo(demo.organizationId, demo.userId);
  } finally {
    await prisma.platformAdmin.delete({ where: { userId: demo.userId } });
  }
  // Y en una organización común la guardia no opina.
  await exigirInvitacionPermitidaEnDemo(comun.organizationId, comun.userId);
});
