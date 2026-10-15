import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findEdicionYRubro } from "../repositories/organization.repository";
import { reclamarReintento } from "../repositories/automation.repository";
import { reintentarPlantillasVencidas } from "../workers/plantillaReintentoWorker";
import {
  crearReglaConMensaje,
  obtenerReglaConAprobacion,
  reintentarPlantillaDeLaRegla,
  reintentoAutomaticoDeLaPlantilla,
  type DepsDeReglaConMensaje,
} from "./automationWhatsapp.service";
import { registroDeAcciones } from "./automationActions";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { WhatsappGraphError } from "./whatsappGraph.service";
import type { DepsDePlantillas } from "./whatsappTemplate.service";
import { ESPERAS_DEL_REINTENTO_EN_MINUTOS } from "./whatsappTemplateReintento";

// ---------------------------------------------------------------------------
// H-1 (docs-privados/prueba-s7-2026-10-15.md, local): el alta de la plantilla
// de WhatsApp que falla se reintenta sola si el error es temporal, con espera
// creciente y tope, y no se reintenta si Meta rechazó el pedido. Contra
// Postgres y con un doble de la Graph API: nunca se habla con Meta.
// ---------------------------------------------------------------------------

// Lo que contesta el doble de Meta al alta: "ok", un 503 o un 400.
let respuesta: "ok" | "temporal" | "definitivo" = "ok";
let altas = 0;

const plantillas: DepsDePlantillas = {
  wabaId: () => "111111111111111",
  accessToken: () => "token-de-la-plataforma",
  rubroDe: (organizationId) => findEdicionYRubro(organizationId).then((o) => o.industry),
  appId: () => "app-de-prueba",
  create: () => {
    altas++;
    if (respuesta === "temporal") {
      return Promise.reject(
        new WhatsappGraphError(503, '{"error":{"message":"Service Unavailable"}}'),
      );
    }
    if (respuesta === "definitivo") {
      return Promise.reject(
        new WhatsappGraphError(
          400,
          '{"error":{"message":"Invalid parameter","error_user_msg":"El texto no cumple las reglas"}}',
        ),
      );
    }
    return Promise.resolve({ id: String(randomInt(1_000_000, 9_999_999)), status: "PENDING" });
  },
  delete: () => Promise.resolve(),
  getStatus: () => Promise.resolve({ status: "PENDING", rejectedReason: null }),
  uploadSample: () => Promise.resolve("4::handle-de-ejemplo"),
  nombreNuevo: () => `test_reintento_${String(randomInt(100_000_000, 999_999_999))}`,
};

const deps: DepsDeReglaConMensaje = { plantillas, baseDeLaApi: () => "https://api.test" };

let organizationId: string;

function reglaQr() {
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

const fila = (id: string) => prisma.automation.findUniqueOrThrow({ where: { id } });
const minutos = (desde: Date, hasta: Date | null) =>
  hasta ? Math.round((hasta.getTime() - desde.getTime()) / 60_000) : null;

/** Una pasada del worker "en el futuro", con el doble de Meta. */
const pasada = () =>
  reintentarPlantillasVencidas({
    ahora: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    reintentar: (regla) => reintentoAutomaticoDeLaPlantilla(regla, deps),
  });

before(async () => {
  if (registroDeAcciones.tiposRegistrados().length === 0) registrarAutomatizaciones();
  const org = await prisma.organization.create({
    data: {
      name: "Reintento de plantillas",
      slug: `plantilla-reintento-automotora-${Date.now()}-${randomUUID().slice(0, 8)}`,
      industry: "AUTOMOTORA",
    },
  });
  organizationId = org.id;
});

beforeEach(async () => {
  respuesta = "ok";
  altas = 0;
  await prisma.whatsappTemplate.deleteMany({ where: { organizationId } });
  await prisma.automation.deleteMany({ where: { organizationId } });
});

after(async () => {
  await prisma.whatsappTemplate.deleteMany({ where: { organizationId } });
  await prisma.automation.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
});

test("temporal: queda REINTENTANDO a los 5 min; el worker reintenta con espera creciente y, cuando Meta responde, limpia", async () => {
  respuesta = "temporal";
  const antes = new Date();
  const regla = await crearReglaConMensaje(organizationId, reglaQr(), deps);
  assert.ok(regla.whatsappSyncError);
  assert.equal(regla.whatsappSync?.estado, "REINTENTANDO");
  assert.ok(regla.whatsappSync?.proximoIntento);
  assert.equal(regla.whatsappApproval?.estado, "SIN_PLANTILLA");
  // La API no expone las columnas crudas.
  assert.equal("templateSyncAttempts" in regla, false);
  let f = await fila(regla.id);
  assert.equal(f.templateSyncAttempts, 1);
  assert.equal(f.templateSyncErrorKind, "TEMPORAL");
  assert.equal(minutos(antes, f.templateSyncNextAt), 5);

  // Segundo intento (del worker), Meta sigue sin responder: 15 minutos.
  const desde = new Date();
  assert.equal((await pasada()).reintentadas, 1);
  f = await fila(regla.id);
  assert.equal(f.templateSyncAttempts, 2);
  assert.equal(minutos(desde, f.templateSyncNextAt), 15);

  // Meta vuelve: el tercer intento da de alta la plantilla y limpia todo.
  respuesta = "ok";
  const r = await pasada();
  assert.equal(r.reintentadas, 1);
  assert.equal(r.conExito, 1);
  f = await fila(regla.id);
  assert.equal(f.templateSyncAttempts, 0);
  assert.equal(f.templateSyncNextAt, null);
  assert.equal(f.templateSyncError, null);
  assert.equal(f.templateSyncErrorKind, null);
  const leida = await obtenerReglaConAprobacion(organizationId, regla.id);
  assert.equal(leida.whatsappSync, null);
  assert.equal(leida.whatsappApproval?.estado, "PENDIENTE");
  assert.equal((await pasada()).reintentadas, 0, "nada más que reintentar");
});

test("tope: después del último intento automático queda DETENIDO y el worker no la toma más; Reintentar reinicia la cuenta", async () => {
  respuesta = "temporal";
  const regla = await crearReglaConMensaje(organizationId, reglaQr(), deps);
  for (const espera of ESPERAS_DEL_REINTENTO_EN_MINUTOS.slice(1)) {
    const desde = new Date();
    assert.equal((await pasada()).reintentadas, 1);
    assert.equal(minutos(desde, (await fila(regla.id)).templateSyncNextAt), espera);
  }
  // El intento que agota las esperas: para.
  assert.equal((await pasada()).reintentadas, 1);
  const f = await fila(regla.id);
  assert.equal(f.templateSyncAttempts, ESPERAS_DEL_REINTENTO_EN_MINUTOS.length + 1);
  assert.equal(f.templateSyncNextAt, null);
  assert.equal(
    (await obtenerReglaConAprobacion(organizationId, regla.id)).whatsappSync?.estado,
    "DETENIDO",
  );
  assert.equal((await pasada()).reintentadas, 0);

  // "Reintentar" con Meta todavía caída: vuelve a empezar desde 5 minutos.
  const desde = new Date();
  const otra = await reintentarPlantillaDeLaRegla(organizationId, regla.id, deps);
  assert.equal(otra.whatsappSync?.estado, "REINTENTANDO");
  assert.equal((await fila(regla.id)).templateSyncAttempts, 1);
  assert.equal(minutos(desde, (await fila(regla.id)).templateSyncNextAt), 5);

  // "Reintentar" con Meta de vuelta: queda en revisión, sin aviso.
  respuesta = "ok";
  const ok = await reintentarPlantillaDeLaRegla(organizationId, regla.id, deps);
  assert.equal(ok.whatsappSync, null);
  assert.equal(ok.whatsappApproval?.estado, "PENDIENTE");
});

test("definitivo: Meta rechazó el pedido, queda RECHAZADO con el motivo y no se reintenta", async () => {
  respuesta = "definitivo";
  const regla = await crearReglaConMensaje(organizationId, reglaQr(), deps);
  assert.equal(regla.whatsappSync?.estado, "RECHAZADO");
  assert.match(regla.whatsappSync?.motivo ?? "", /^Meta rechazó el pedido/);
  assert.equal(regla.whatsappSync?.proximoIntento, null);
  const f = await fila(regla.id);
  assert.equal(f.templateSyncErrorKind, "DEFINITIVO");
  assert.equal(f.templateSyncNextAt, null);
  const altasAntes = altas;
  assert.equal((await pasada()).reintentadas, 0);
  assert.equal(altas, altasAntes, "no se volvió a llamar a Meta");
});

test("dos instancias del worker no reintentan la misma regla: el reclamo es de una sola", async () => {
  respuesta = "temporal";
  const regla = await crearReglaConMensaje(organizationId, reglaQr(), deps);
  const { templateSyncNextAt } = await fila(regla.id);
  assert.ok(templateSyncNextAt);
  const hasta = new Date(Date.now() + 10 * 60 * 1000);
  assert.equal(await reclamarReintento(regla.id, templateSyncNextAt, hasta), true);
  assert.equal(await reclamarReintento(regla.id, templateSyncNextAt, hasta), false);
});

test("una regla que deja de mandar WhatsApp no se reintenta", async () => {
  respuesta = "temporal";
  const regla = await crearReglaConMensaje(organizationId, reglaQr(), deps);
  await prisma.automation.update({
    where: { id: regla.id },
    data: {
      actionType: "activity.create_follow_up",
      actionConfig: { subject: "x", daysUntilDue: 0 },
    },
  });
  const altasAntes = altas;
  const r = await pasada();
  assert.equal(r.reintentadas, 1);
  assert.equal(altas, altasAntes);
  const f = await fila(regla.id);
  assert.equal(f.templateSyncNextAt, null);
  assert.equal(f.templateSyncError, null);
});
