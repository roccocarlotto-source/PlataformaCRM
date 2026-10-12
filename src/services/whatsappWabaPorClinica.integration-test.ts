import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type { OrganizationIndustry, Prisma } from "@prisma/client";
import { TEXTO_POR_DEFECTO_DEL_RECORDATORIO } from "../clinicas/recordatorios/config";
import { prisma } from "../lib/prisma";
import { findEdicionYRubro } from "../repositories/organization.repository";
import { findWabaPropio } from "../repositories/whatsappBusinessConnection.repository";
import { AppError } from "../utils/AppError";
import { NUMERO_DE_OTRO_WABA, asignarNumeroDeWhatsapp } from "./agent.service";
import {
  CONECTA_EL_NUMERO_DE_LA_CLINICA,
  actualizarReglaConMensaje,
  crearReglaConMensaje,
  type DepsDeReglaConMensaje,
} from "./automationWhatsapp.service";
import { registroDeAcciones } from "./automationActions";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { createBranch } from "./branch.service";
import {
  SOLO_CLINICAS,
  WABA_DE_OTRA_ORGANIZACION,
  conectarWabaDeLaClinica,
  desconectarWabaDeLaClinica,
} from "./whatsappBusinessConnection.service";
import {
  WhatsappGraphError,
  type CreateWhatsappTemplateInput,
  type DeleteWhatsappTemplateInput,
} from "./whatsappGraph.service";
import type { DepsDePlantillas } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// El WABA propio de una clínica (docs/whatsapp-alta-clinica.md), contra
// Postgres y con un doble de la Graph API: nunca se habla con Meta.
//
//   - Automotora (AutoMax incluida) sin fila: la plantilla va al WABA global
//     exacto, como siempre.
//   - Clínica sin WABA propio: una regla con plantilla activa es 409 y no se
//     llama a Meta; inactiva se guarda sin plantilla.
//   - Clínica con WABA propio: la plantilla va a ese WABA y la fila lo guarda.
//   - El alta: solo CLINICA, un WABA de una sola organización, sin alta a
//     medias si Meta no deja suscribir la app, y las plantillas de sus reglas
//     pasan al WABA propio.
//   - Un número fuera del WABA propio no se le asigna a un agente (400).
// ---------------------------------------------------------------------------

const WABA_GLOBAL = "111111111111111";
const WABA_DE_LA_CLINICA = "222222222222222";
const WABA_DE_OTRA_CLINICA = "333333333333333";

let altas: CreateWhatsappTemplateInput[] = [];
let bajas: DeleteWhatsappTemplateInput[] = [];
let suscripciones: string[] = [];
let fallaLaSuscripcion = false;

const plantillas: DepsDePlantillas = {
  wabaId: () => WABA_GLOBAL,
  accessToken: () => "token-de-la-plataforma",
  wabaPropio: (organizationId) => findWabaPropio(organizationId),
  rubroDe: (organizationId) => findEdicionYRubro(organizationId).then((o) => o.industry),
  appId: () => "app-de-prueba",
  create: (input) => {
    altas.push(input);
    return Promise.resolve({ id: String(randomInt(1_000_000, 9_999_999)), status: "PENDING" });
  },
  delete: (input) => {
    bajas.push(input);
    return Promise.resolve();
  },
  getStatus: () => Promise.resolve({ status: "PENDING", rejectedReason: null }),
  uploadSample: () => Promise.resolve("4::handle-de-ejemplo"),
  nombreNuevo: () => `test_waba_${String(randomInt(100_000_000, 999_999_999))}`,
};

const deps: DepsDeReglaConMensaje = { plantillas, baseDeLaApi: () => "https://api.test" };

const depsDeAlta = {
  accessToken: () => "token-de-la-plataforma",
  subscribeApp: ({ wabaId }: { wabaId: string }) => {
    suscripciones.push(wabaId);
    return fallaLaSuscripcion
      ? Promise.reject(new WhatsappGraphError(403, '{"error":{"message":"No es socio"}}'))
      : Promise.resolve();
  },
  plantillas,
};

const organizaciones: string[] = [];

async function crearOrganizacion(etiqueta: string, industry: OrganizationIndustry) {
  const org = await prisma.organization.create({
    data: {
      name: `WABA ${etiqueta}`,
      slug: `waba-clinica-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      industry,
    },
  });
  organizaciones.push(org.id);
  return org.id;
}

function reglaDeRecordatorio(isActive: boolean) {
  return {
    name: `Recordatorio ${randomUUID().slice(0, 8)}`,
    triggerType: "booking.reminder_due",
    actionType: "booking.send_reminder",
    actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO },
    isActive,
  };
}

function reglaQrDeAutomotora() {
  return {
    name: `Regla QR ${randomUUID().slice(0, 8)}`,
    triggerType: "opportunity.won",
    actionType: "opportunity.send_qr_followup",
    actionConfig: {
      qrCodeId: randomUUID(),
      delayHours: 24,
      messageText: "Hola {nombre}, gracias por tu compra. Tu opinión acá: {link} ¡Gracias!",
    },
    isActive: false,
  };
}

function esAppError(status: number, mensaje?: string) {
  return (err: unknown) =>
    err instanceof AppError &&
    err.statusCode === status &&
    (mensaje === undefined || err.message.startsWith(mensaje));
}

before(() => {
  if (registroDeAcciones.tiposRegistrados().length === 0) registrarAutomatizaciones();
});

beforeEach(() => {
  altas = [];
  bajas = [];
  suscripciones = [];
  fallaLaSuscripcion = false;
});

after(async () => {
  const where = { organizationId: { in: organizaciones } };
  await prisma.whatsappTemplate.deleteMany({ where });
  await prisma.automation.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.branchBusinessHours.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.whatsappBusinessConnection.deleteMany({ where });
  await prisma.clinicSettings.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: organizaciones } } });
});

test("automotora sin fila (como AutoMax): la plantilla va al WABA global exacto y la fila no guarda WABA", async () => {
  const org = await crearOrganizacion("automotora", "AUTOMOTORA");
  const regla = await crearReglaConMensaje(org, reglaQrDeAutomotora(), deps);
  assert.equal(regla.whatsappSyncError ?? null, null);
  assert.equal(altas.length, 1);
  assert.equal(altas[0].wabaId, WABA_GLOBAL);
  assert.equal(altas[0].accessToken, "token-de-la-plataforma");
  const fila = await prisma.whatsappTemplate.findFirstOrThrow({
    where: { automationId: regla.id },
  });
  assert.equal(fila.wabaId, null);
  assert.equal(
    await prisma.whatsappBusinessConnection.count({ where: { organizationId: org } }),
    0,
  );
});

test("clínica sin WABA propio: activa es 409 y no llama a Meta; inactiva se guarda sin plantilla", async () => {
  const org = await crearOrganizacion("sin-waba", "CLINICA");
  await assert.rejects(
    crearReglaConMensaje(org, reglaDeRecordatorio(true), deps),
    esAppError(409, CONECTA_EL_NUMERO_DE_LA_CLINICA),
  );
  assert.equal(await prisma.automation.count({ where: { organizationId: org } }), 0);

  const inactiva = await crearReglaConMensaje(org, reglaDeRecordatorio(false), deps);
  assert.ok(inactiva.whatsappSyncError);
  assert.equal(altas.length, 0, "no se llamó a Meta");
  assert.equal(await prisma.whatsappTemplate.count({ where: { organizationId: org } }), 0);

  await assert.rejects(
    actualizarReglaConMensaje(org, inactiva.id, { isActive: true }, deps),
    esAppError(409, CONECTA_EL_NUMERO_DE_LA_CLINICA),
  );
  const sigue = await prisma.automation.findUniqueOrThrow({ where: { id: inactiva.id } });
  assert.equal(sigue.isActive, false);
  assert.equal(altas.length, 0);
});

test("el alta: solo una clínica, un WABA de una sola organización, y sin alta a medias si Meta no deja suscribir la app", async () => {
  const automotora = await crearOrganizacion("alta-automotora", "AUTOMOTORA");
  await assert.rejects(
    conectarWabaDeLaClinica(
      { organizationId: automotora, wabaId: WABA_DE_OTRA_CLINICA, platformAdminUserId: "pa" },
      depsDeAlta,
    ),
    esAppError(400, SOLO_CLINICAS),
  );

  const clinica = await crearOrganizacion("alta-falla", "CLINICA");
  fallaLaSuscripcion = true;
  await assert.rejects(
    conectarWabaDeLaClinica(
      { organizationId: clinica, wabaId: WABA_DE_OTRA_CLINICA, platformAdminUserId: "pa" },
      depsDeAlta,
    ),
    esAppError(502),
  );
  assert.equal(await findWabaPropio(clinica), null, "sin fila: el alta no quedó a medias");

  fallaLaSuscripcion = false;
  await conectarWabaDeLaClinica(
    { organizationId: clinica, wabaId: WABA_DE_OTRA_CLINICA, platformAdminUserId: "pa" },
    depsDeAlta,
  );
  const otra = await crearOrganizacion("alta-otra", "CLINICA");
  await assert.rejects(
    conectarWabaDeLaClinica(
      { organizationId: otra, wabaId: WABA_DE_OTRA_CLINICA, platformAdminUserId: "pa" },
      depsDeAlta,
    ),
    esAppError(409, WABA_DE_OTRA_ORGANIZACION),
  );
});

test("clínica con WABA propio: la plantilla va a su WABA; al conectarlo, la plantilla vieja del global se reemplaza", async () => {
  const org = await crearOrganizacion("con-waba", "CLINICA");
  // Una regla inactiva con una plantilla del WABA global (de antes del alta).
  const regla = await prisma.automation.create({
    data: {
      organizationId: org,
      name: "Recordatorio antes del turno",
      triggerType: "booking.reminder_due",
      actionType: "booking.send_reminder",
      triggerConfig: {},
      actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO } as Prisma.InputJsonValue,
      isActive: false,
    },
  });
  await prisma.whatsappTemplate.create({
    data: {
      organizationId: org,
      automationId: regla.id,
      name: `test_waba_global_${randomUUID().slice(0, 8)}`,
      language: "es_AR",
      bodyText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
      metaTemplateId: String(randomInt(1_000_000, 9_999_999)),
      status: "PENDING",
    },
  });

  const alta = await conectarWabaDeLaClinica(
    { organizationId: org, wabaId: WABA_DE_LA_CLINICA, platformAdminUserId: "pa" },
    depsDeAlta,
  );
  assert.deepEqual(suscripciones, [WABA_DE_LA_CLINICA]);
  assert.equal(alta.reglasSincronizadas, 1);
  assert.deepEqual(alta.erroresDeSincronizacion, []);
  // La candidata del global se borró en el global; la nueva, en el WABA propio.
  assert.deepEqual(
    bajas.map((b) => b.wabaId),
    [WABA_GLOBAL],
  );
  assert.deepEqual(
    altas.map((a) => a.wabaId),
    [WABA_DE_LA_CLINICA],
  );
  const vivas = await prisma.whatsappTemplate.findMany({
    where: { automationId: regla.id, deletedAt: null },
  });
  assert.equal(vivas.length, 1);
  assert.equal(vivas[0].wabaId, WABA_DE_LA_CLINICA);

  // Con WABA propio, activar la regla ya no es 409.
  const activa = await actualizarReglaConMensaje(org, regla.id, { isActive: true }, deps);
  assert.equal(activa.isActive, true);

  // Con reglas con plantilla activas no se desconecta.
  await assert.rejects(
    desconectarWabaDeLaClinica({ organizationId: org, platformAdminUserId: "pa" }),
    esAppError(409),
  );
});

test("un número que no es del WABA propio no se le asigna a un agente (400); uno del WABA sí", async () => {
  const org = await crearOrganizacion("numero", "CLINICA");
  await prisma.whatsappBusinessConnection.create({
    data: { organizationId: org, wabaId: `9${String(randomInt(100_000_000, 999_999_999))}` },
  });
  const branch = await createBranch(org, { name: "Sede", timezone: "UTC" });
  const agente = await prisma.agent.create({
    data: {
      organizationId: org,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const delWaba = `5${String(randomInt(100_000_000, 999_999_999))}`;
  const depsDelNumero = {
    wabaPropio: (organizationId: string) => findWabaPropio(organizationId),
    accessToken: () => "token-de-la-plataforma",
    numerosDelWaba: () => Promise.resolve([delWaba]),
  };

  await assert.rejects(
    asignarNumeroDeWhatsapp(
      { agentId: agente.id, whatsappPhoneNumberId: "4444444444", platformAdminUserId: "pa" },
      depsDelNumero,
    ),
    esAppError(400, NUMERO_DE_OTRO_WABA),
  );
  const asignado = await asignarNumeroDeWhatsapp(
    { agentId: agente.id, whatsappPhoneNumberId: delWaba, platformAdminUserId: "pa" },
    depsDelNumero,
  );
  assert.equal(asignado.whatsappPhoneNumberId, delWaba);
});
