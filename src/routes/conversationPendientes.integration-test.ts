import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "./gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// UX-02 (docs-privados/auditoria-2026-10-21/informe-etapa-2.md, local): el
// número del menú (GET /api/conversations/pendientes/count) y la bandeja con
// "Mis pendientes" (GET /api/conversations?pendientes=true) tienen que dar
// EXACTAMENTE lo mismo, con el mismo filtro de permisos, para cada rol (pedido
// de Rocco). Contra la app real, con el token de cada uno: el rol y las sedes
// salen de authenticate, como en producción.
//
// Una clínica con dos sedes (A y B) y tres personas:
//   - ADMIN: toda la organización;
//   - USER: lo asignado a él más lo que no tiene a nadie asignado;
//   - RECEPCION de la sede A: lo de su sede (R20).
// ---------------------------------------------------------------------------

let org: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

let adminId: string;
let userId: string;
let recepcionId: string;
const ids: Record<string, string> = {};

async function conversacion(datos: {
  nombre: string;
  branchId: string;
  agentId: string;
  status: "ACTIVE" | "TRANSFERRED_TO_HUMAN" | "CLOSED";
  assignedUserId?: string;
  mensajes: { senderType: "CONTACT" | "AGENT" | "HUMAN" | "AUTOMATION"; aviso?: boolean }[];
}) {
  const contacto = await prisma.contact.create({
    data: { organizationId: org.id, firstName: datos.nombre, lastName: "Prueba" },
  });
  const c = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId: datos.branchId,
      agentId: datos.agentId,
      contactId: contacto.id,
      channel: "WHATSAPP",
      status: datos.status,
      assignedUserId: datos.assignedUserId ?? null,
      lastMessageAt: new Date(),
    },
  });
  const inicio = Date.now() - 60_000;
  for (const [i, m] of datos.mensajes.entries()) {
    await prisma.message.create({
      data: {
        organizationId: org.id,
        conversationId: c.id,
        direction: m.senderType === "CONTACT" ? "INBOUND" : "OUTBOUND",
        senderType: m.senderType,
        senderUserId: m.senderType === "HUMAN" ? adminId : null,
        content: `mensaje ${i}`,
        createdAt: new Date(inicio + i * 1000),
        ...(m.aviso ? { noticeType: "UNANSWERED_HANDOFF" as const } : {}),
      },
    });
  }
  ids[datos.nombre] = c.id;
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  org = await crearOrgDePrueba("bandeja-pendientes", "COMPLETA", "CLINICA", 3);
  [adminId, userId, recepcionId] = org.authIds;
  const rolUser = await findRoleByName("USER");
  const rolRecepcion = await findRoleByName("RECEPCION");
  assert.ok(rolUser && rolRecepcion, "roles sembrados");
  await prisma.user.update({ where: { id: userId }, data: { roleId: rolUser.id } });
  await prisma.user.update({ where: { id: recepcionId }, data: { roleId: rolRecepcion.id } });

  const sedeA = await prisma.branch.create({
    data: { organizationId: org.id, name: "Sede A", timezone: "America/Montevideo" },
  });
  const sedeB = await prisma.branch.create({
    data: { organizationId: org.id, name: "Sede B", timezone: "America/Montevideo" },
  });
  await prisma.userBranch.create({
    data: { organizationId: org.id, userId: recepcionId, branchId: sedeA.id },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: sedeA.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const a = { agentId: agent.id };

  // Pendientes:
  await conversacion({
    ...a,
    nombre: "DelUserEnA",
    branchId: sedeA.id,
    status: "TRANSFERRED_TO_HUMAN",
    assignedUserId: userId,
    mensajes: [{ senderType: "CONTACT" }],
  });
  // Sin asignar; el agente avisó "te paso con alguien" después del cliente.
  await conversacion({
    ...a,
    nombre: "SinAsignarEnA",
    branchId: sedeA.id,
    status: "TRANSFERRED_TO_HUMAN",
    mensajes: [{ senderType: "CONTACT" }, { senderType: "AGENT" }],
  });
  await conversacion({
    ...a,
    nombre: "DelAdminEnB",
    branchId: sedeB.id,
    status: "TRANSFERRED_TO_HUMAN",
    assignedUserId: adminId,
    mensajes: [{ senderType: "CONTACT" }],
  });
  // La marca: volvió al agente con el aviso y nadie escribió después.
  await conversacion({
    ...a,
    nombre: "ConMarcaEnB",
    branchId: sedeB.id,
    status: "ACTIVE",
    mensajes: [{ senderType: "CONTACT" }, { senderType: "AUTOMATION", aviso: true }],
  });
  // No pendientes:
  await conversacion({
    ...a,
    nombre: "RespondidaEnA",
    branchId: sedeA.id,
    status: "TRANSFERRED_TO_HUMAN",
    assignedUserId: userId,
    mensajes: [{ senderType: "CONTACT" }, { senderType: "HUMAN" }],
  });
  await conversacion({
    ...a,
    nombre: "ConElAgenteEnA",
    branchId: sedeA.id,
    status: "ACTIVE",
    mensajes: [{ senderType: "CONTACT" }],
  });
  await conversacion({
    ...a,
    nombre: "MarcaRespondidaEnA",
    branchId: sedeA.id,
    status: "ACTIVE",
    mensajes: [
      { senderType: "CONTACT" },
      { senderType: "AUTOMATION", aviso: true },
      { senderType: "HUMAN" },
    ],
  });
  await conversacion({
    ...a,
    nombre: "CerradaEnA",
    branchId: sedeA.id,
    status: "CLOSED",
    mensajes: [{ senderType: "CONTACT" }],
  });
});

after(async () => {
  if (cerrar) await cerrar();
  if (org) {
    const where = { organizationId: org.id };
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
  }
  await borrarOrgDePrueba(org);
});

async function contadorYLista(token: string) {
  const contador = await pedir(org, "GET", "/api/conversations/pendientes/count", undefined, token);
  assert.equal(contador.status, 200, JSON.stringify(contador.json));
  const lista = await pedir(
    org,
    "GET",
    "/api/conversations?pendientes=true&pageSize=100",
    undefined,
    token,
  );
  assert.equal(lista.status, 200, JSON.stringify(lista.json));
  const filas = lista.json.data as { id: string }[];
  const total = (lista.json.pagination as { total: number }).total;
  const nombres = Object.entries(ids)
    .filter(([, id]) => filas.some((f) => f.id === id))
    .map(([nombre]) => nombre)
    .sort();
  return { contador: contador.json.total as number, total, nombres };
}

const casos: { rol: string; indice: number; esperadas: string[] }[] = [
  {
    rol: "ADMIN: toda la organización",
    indice: 0,
    esperadas: ["ConMarcaEnB", "DelAdminEnB", "DelUserEnA", "SinAsignarEnA"],
  },
  {
    rol: "USER: lo suyo más lo que no tiene a nadie asignado",
    indice: 1,
    esperadas: ["ConMarcaEnB", "DelUserEnA", "SinAsignarEnA"],
  },
  {
    rol: "RECEPCION de la sede A: lo de su sede, con el filtro de la bandeja (R20)",
    indice: 2,
    esperadas: ["DelUserEnA", "SinAsignarEnA"],
  },
];

for (const caso of casos) {
  test(`el número del menú y la bandeja «Mis pendientes» dan lo mismo — ${caso.rol}`, async () => {
    const { contador, total, nombres } = await contadorYLista(org.tokens[caso.indice]);
    assert.deepEqual(nombres, caso.esperadas);
    assert.equal(total, caso.esperadas.length, "el total de la lista");
    assert.equal(contador, total, "el número del menú es el total de la lista");
  });
}

test("Recepción: la bandeja sin filtro tampoco le muestra nada de la sede B (el contador no cuenta lo que no puede abrir)", async () => {
  const lista = await pedir(
    org,
    "GET",
    "/api/conversations?pageSize=100",
    undefined,
    org.tokens[2],
  );
  assert.equal(lista.status, 200);
  const filas = lista.json.data as { id: string }[];
  for (const nombre of ["DelAdminEnB", "ConMarcaEnB"]) {
    assert.ok(!filas.some((f) => f.id === ids[nombre]), nombre);
  }
});

test("pendientes=false o sin el parámetro: la bandeja de siempre", async () => {
  const sin = await pedir(org, "GET", "/api/conversations?pageSize=100", undefined, org.tokens[0]);
  const conFalse = await pedir(
    org,
    "GET",
    "/api/conversations?pendientes=false&pageSize=100",
    undefined,
    org.tokens[0],
  );
  assert.equal(
    (sin.json.pagination as { total: number }).total,
    Object.keys(ids).length,
    "todas las de la organización",
  );
  assert.deepEqual(conFalse.json.pagination, sin.json.pagination);
});
