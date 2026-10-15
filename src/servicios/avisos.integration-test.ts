import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { ServiceOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import type { AvisosDeLaOrden } from "./services/avisos.service";

// ---------------------------------------------------------------------------
// S12 de docs/servicios.md (§8.1): avisar al cliente desde la orden.
//
//   - El texto sugerido por estado, completado con el cliente, el vehículo y
//     la sucursal; en los demás estados, ninguno.
//   - La conversación de WhatsApp del cliente y si la ventana de 24 h está
//     abierta (cerrada si el cliente escribió hace más de 24 h, o si la
//     conversación está cerrada; sin conversación, null).
//   - "Marcar como avisado" con el medio deja la nota en la orden.
//   - 400, 404 de otra organización y 403 sin el módulo.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let sinModulo: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let sucursal: string;
let numero = 0;

async function orden(status: ServiceOrderStatus, contacto?: { phone?: string }) {
  const c = await prisma.contact.create({
    data: {
      organizationId: taller.id,
      firstName: "Ana",
      lastName: "Prueba",
      phone: contacto?.phone ?? null,
    },
  });
  const v = await prisma.customerVehicle.create({
    data: {
      organizationId: taller.id,
      contactId: c.id,
      branchId: sucursal,
      make: "Fiat",
      model: "Uno",
      licensePlate: `AV ${String(++numero)}`,
      licensePlateNorm: `AV${String(numero)}`,
    },
  });
  const o = await prisma.serviceOrder.create({
    data: {
      organizationId: taller.id,
      number: numero,
      customerVehicleId: v.id,
      contactId: c.id,
      branchId: sucursal,
      status,
      createdById: taller.authIds[0],
    },
  });
  return { orden: o, contactId: c.id, placa: v.licensePlate };
}

async function conversacion(contactId: string, ultimoEntranteHaceHoras: number, cerrada = false) {
  const agente = await prisma.agent.findFirst({ where: { organizationId: taller.id } });
  const conv = await prisma.conversation.create({
    data: {
      organizationId: taller.id,
      branchId: sucursal,
      agentId: agente!.id,
      contactId,
      channel: "WHATSAPP",
      status: cerrada ? "CLOSED" : "ACTIVE",
      externalThreadId: `598${String(Math.floor(Math.random() * 1e8))}`,
      lastMessageAt: new Date(),
    },
  });
  await prisma.message.create({
    data: {
      organizationId: taller.id,
      conversationId: conv.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Hola",
      createdAt: new Date(Date.now() - ultimoEntranteHaceHoras * 60 * 60 * 1000),
    },
  });
  return conv.id;
}

const avisos = async (id: string, org = taller) => {
  const r = await pedir(org, "GET", `/api/servicios/ordenes/${id}/avisos`);
  return { status: r.status, json: r.json as unknown as AvisosDeLaOrden };
};

async function limpiar() {
  const where = { organizationId: taller.id };
  await prisma.activity.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.serviceOrder.deleteMany({ where });
  await prisma.customerVehicle.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-avisos", "COMPLETA", "AUTOMOTORA", 1);
  sinModulo = await crearOrgDePrueba("servicios-avisos", "COMPLETA", "AUTOMOTORA", 1);
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  sucursal = (await createBranch(taller.id, { name: "Centro", timezone: "America/Montevideo" })).id;
  await prisma.agent.create({
    data: {
      organizationId: taller.id,
      branchId: sucursal,
      name: "Agente",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      isActive: false,
    },
  });
});

beforeEach(async () => {
  numero = 0;
  await limpiar();
});

after(async () => {
  if (cerrar) await cerrar();
  await limpiar();
  await prisma.agent.deleteMany({ where: { organizationId: taller.id } });
  for (const org of [taller, sinModulo]) await borrarOrgDePrueba(org);
});

test("el texto sugerido por estado, con el cliente, el vehículo y la sucursal; en otros estados, ninguno", async () => {
  const listo = await orden("LISTO_PARA_RETIRAR", { phone: "+59899000111" });
  const r = await avisos(listo.orden.id);
  assert.equal(r.status, 200);
  assert.equal(
    r.json.sugerencia,
    `Hola Ana, tu Fiat Uno (${listo.placa!}) ya está listo. Podés pasar a retirarlo por Centro.`,
  );
  assert.equal(r.json.telefono, "+59899000111");
  assert.equal(r.json.conversacion, null, "sin conversación de WhatsApp");
  assert.deepEqual(r.json.avisos, []);

  const recibido = await orden("RECIBIDO");
  assert.match(
    (await avisos(recibido.orden.id)).json.sugerencia ?? "",
    /^Hola Ana, ya recibimos tu Fiat Uno/,
  );
  const esperando = await orden("ESPERANDO_APROBACION");
  assert.match((await avisos(esperando.orden.id)).json.sugerencia ?? "", /presupuesto\?$/);
  const enTrabajo = await orden("EN_TRABAJO");
  assert.equal((await avisos(enTrabajo.orden.id)).json.sugerencia, null);
});

test("la conversación de WhatsApp: ventana abierta, vencida (más de 24 h) o cerrada", async () => {
  const abierta = await orden("LISTO_PARA_RETIRAR");
  const idAbierta = await conversacion(abierta.contactId, 2);
  assert.deepEqual((await avisos(abierta.orden.id)).json.conversacion, {
    id: idAbierta,
    ventanaAbierta: true,
  });

  const vencida = await orden("LISTO_PARA_RETIRAR");
  await conversacion(vencida.contactId, 30);
  assert.equal((await avisos(vencida.orden.id)).json.conversacion?.ventanaAbierta, false);

  const cerrada = await orden("LISTO_PARA_RETIRAR");
  await conversacion(cerrada.contactId, 1, true);
  assert.equal((await avisos(cerrada.orden.id)).json.conversacion?.ventanaAbierta, false);
});

test("Marcar como avisado: la nota con el medio y quién; 400 con un medio que no existe", async () => {
  const { orden: o, contactId } = await orden("LISTO_PARA_RETIRAR");
  const r = await pedir(taller, "POST", `/api/servicios/ordenes/${o.id}/avisos`, {
    medio: "TELEFONO",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const lista = r.json as unknown as AvisosDeLaOrden["avisos"];
  assert.equal(lista.length, 1);
  assert.equal(lista[0].detalle, "Aviso al cliente (Teléfono): Listo para retirar");

  const [nota] = await prisma.activity.findMany({ where: { sourceServiceOrderId: o.id } });
  assert.equal(nota.type, "NOTE");
  assert.equal(nota.contactId, contactId);
  assert.equal(nota.authorId, taller.authIds[0]);
  assert.ok(nota.completedAt, "un registro, no algo pendiente");

  // Dos avisos de la misma orden conviven (el único de S6 es por regla).
  await pedir(taller, "POST", `/api/servicios/ordenes/${o.id}/avisos`, { medio: "EN_PERSONA" });
  assert.equal((await avisos(o.id)).json.avisos.length, 2);

  const malo = await pedir(taller, "POST", `/api/servicios/ordenes/${o.id}/avisos`, {
    medio: "PALOMA",
  });
  assert.equal(malo.status, 400);
});

test("otra organización: 404; sin el módulo: 403", async () => {
  const { orden: o } = await orden("LISTO_PARA_RETIRAR");
  const otra = await crearOrgDePrueba("servicios-avisos", "COMPLETA", "AUTOMOTORA", 1);
  try {
    await activarModulo(otra.id, "servicios", otra.authIds[0]);
    assert.equal((await avisos(o.id, otra)).status, 404);
  } finally {
    await borrarOrgDePrueba(otra);
  }
  assert.equal((await avisos(o.id, sinModulo)).status, 403);
});
