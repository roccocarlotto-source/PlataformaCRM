import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { vocabularioDe } from "../config/vocabulario";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import { createBranch } from "../services/branch.service";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (docs/rubros.md §0.3 y §14.1), contra la app
// real. El par unitario es automotoraSinCambios.test.ts; cada PR del plan de
// clínicas que toca el núcleo le agrega su caso a uno de los dos.
//
// Dos automotoras, una COMPLETA y una ESENCIAL, con ADMIN reales. Los valores
// esperados son FIJOS, los de antes de R2.
//
// Casos de R2: /api/me (las claves de antes más `industry`, y los mismos
// módulos) y el 403 y el 400 del gate por HTTP (el cuerpo de antes más
// `motivo`). El barrido de todas las rutas está en
// src/routes/ediciones.integration-test.ts.
//
// Caso de R20 (usuarios por sede): una automotora con dos sucursales, un ADMIN
// y un USER. /me, los listados de turnos, conversaciones, tareas, usuarios e
// invitaciones y el 403 de una ruta de ADMIN, con las claves y lo visible de
// antes de R20.
// ---------------------------------------------------------------------------

let completa: OrgDePrueba;
let esencial: OrgDePrueba;
// R20: ADMIN (0) y USER (1), con dos sucursales.
let conSucursales: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  completa = await crearOrgDePrueba("automotora-sin-cambios", "COMPLETA", "AUTOMOTORA", 1);
  esencial = await crearOrgDePrueba("automotora-sin-cambios", "ESENCIAL", "AUTOMOTORA", 1);
  conSucursales = await crearOrgDePrueba("automotora-sin-cambios", "COMPLETA", "AUTOMOTORA", 2);
  const usuario = await findRoleByName("USER");
  if (!usuario) throw new Error("Falta el rol USER");
  await prisma.user.update({
    where: { id: conSucursales.authIds[1] },
    data: { roleId: usuario.id },
  });
});

after(async () => {
  if (cerrar) await cerrar();
  await borrarOrgDePrueba(completa);
  await borrarOrgDePrueba(esencial);
  if (conSucursales) {
    const where = { organizationId: conSucursales.id };
    await prisma.booking.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await borrarOrgDePrueba(conSucursales);
  }
});

// Las claves de /api/me antes de R2. R2 suma `industry`; R3, `vocabulario`
// (una automotora no tiene `contactTerm`); R12, `rolesAsignables`.
const CLAVES_DE_ME_DE_HOY = [
  "canUseInternalAgent",
  "edition",
  "email",
  "fullName",
  "id",
  "internalAgentConfigured",
  "isPlatformAdmin",
  "modulos",
  "organizationId",
  "role",
];

const SOLO_COMPLETA = [
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
];

const MODULOS_DE_HOY_COMPLETA = [
  "comun",
  "plataforma",
  "usuarios",
  "contactos",
  "conversaciones",
  "agentes",
  "canales",
  "base_de_conocimiento",
  "sucursales",
  "agenda",
  "stock",
  "tareas",
  "cupones_y_qr",
  "automatizaciones",
  "oportunidades",
  "campos_personalizados",
  "agente_interno",
  "ingesta",
  "dashboard_atencion",
  ...SOLO_COMPLETA,
];

test("/api/me de una automotora: las claves de antes más industry, vocabulario y rolesAsignables, y los mismos módulos", async () => {
  for (const org of [completa, esencial]) {
    const me = await pedir(org, "GET", "/api/me");
    assert.equal(me.status, 200);
    assert.deepEqual(
      Object.keys(me.json).sort(),
      [...CLAVES_DE_ME_DE_HOY, "industry", "vocabulario", "rolesAsignables"].sort(),
    );
    // R12: los dos roles de siempre; Recepción no es de una automotora.
    assert.deepEqual(me.json.rolesAsignables, ["ADMIN", "USER"]);
    // Los textos de hoy (fijados uno por uno en automotoraSinCambios.test.ts).
    assert.deepEqual(me.json.vocabulario, vocabularioDe("AUTOMOTORA", null));
    assert.equal(
      (me.json.vocabulario as { contacto: { pluralTitulo: string } }).contacto.pluralTitulo,
      "Clientes",
    );
    assert.equal(me.json.edition, org.edition);
    assert.equal(me.json.industry, "AUTOMOTORA");
    assert.deepEqual(
      me.json.modulos,
      org.edition === "COMPLETA"
        ? MODULOS_DE_HOY_COMPLETA
        : MODULOS_DE_HOY_COMPLETA.filter((m) => !SOLO_COMPLETA.includes(m)),
      org.edition,
    );
  }
});

test("el 403 por HTTP de una automotora ESENCIAL: el cuerpo de antes más motivo EDICION; COMPLETA no lo ve", async () => {
  const bloqueada = await pedir(esencial, "GET", "/api/quotes");
  assert.equal(bloqueada.status, 403);
  const { code, modulo, motivo, ...resto } = bloqueada.json.error ?? {};
  assert.equal(code, "MODULO_NO_INCLUIDO");
  assert.equal(modulo, "cotizaciones");
  assert.equal(motivo, "EDICION");
  assert.deepEqual(resto, { message: "Esta función no está incluida en tu edición." });

  const enCompleta = await pedir(completa, "GET", "/api/quotes");
  assert.notEqual(enCompleta.json.error?.code, "MODULO_NO_INCLUIDO");

  // Lo que una clínica no tiene, una automotora lo sigue teniendo.
  for (const org of [completa, esencial]) {
    const stock = await pedir(org, "GET", "/api/vehicles");
    assert.equal(stock.status, 200, `${org.edition}: /api/vehicles`);
  }
});

// ---------------------------------------------------------------------------
// R20 (usuarios por sede, docs/rubros.md §11.5). Las claves de cada fila son
// las de antes de R20: activities.branch_id no sale en la respuesta de una
// automotora, y usuarios e invitaciones no suman `branches`.
// ---------------------------------------------------------------------------

const CLAVES_DE_TAREA_DE_HOY = [
  "assigneeId",
  "authorId",
  "body",
  "companyId",
  "completedAt",
  "confirmedAt",
  "confirmedById",
  "contactId",
  "createdAt",
  "deletedAt",
  "dueDate",
  "id",
  "occurredAt",
  "opportunityId",
  "organizationId",
  "subject",
  "type",
  "updatedAt",
];

async function sucursalConDatos(org: OrgDePrueba, nombre: string) {
  const branch = await createBranch(org.id, { name: nombre, timezone: "America/Montevideo" });
  const contacto = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Cliente", lastName: nombre },
  });
  const recurso = await prisma.resource.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: `Vendedor ${nombre}`,
      type: "PERSON",
    },
  });
  const servicio = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      resourceId: recurso.id,
      name: `Test drive ${nombre}`,
      durationMin: 30,
    },
  });
  const inicio = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const turno = await prisma.booking.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      serviceTypeId: servicio.id,
      resourceId: recurso.id,
      contactId: contacto.id,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + 30 * 60 * 1000),
    },
  });
  const agente = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: `Asistente ${nombre}`,
      instructions: "Asistente de prueba.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      agentId: agente.id,
      contactId: contacto.id,
      channel: "WEB",
    },
  });
  // Una tarea del USER y una del ADMIN.
  const delUser = await prisma.activity.create({
    data: {
      organizationId: org.id,
      authorId: org.authIds[0],
      assigneeId: org.authIds[1],
      contactId: contacto.id,
      type: "TASK",
      subject: `Llamar ${nombre}`,
    },
  });
  await prisma.activity.create({
    data: {
      organizationId: org.id,
      authorId: org.authIds[0],
      assigneeId: org.authIds[0],
      contactId: contacto.id,
      type: "TASK",
      subject: `Del admin ${nombre}`,
    },
  });
  return { bookingId: turno.id, conversationId: conversacion.id, tareaDelUser: delUser.id };
}

test("R20: una automotora con dos sucursales ve lo de antes, con las claves de antes", async () => {
  const uno = await sucursalConDatos(conSucursales, "Centro");
  const dos = await sucursalConDatos(conSucursales, "Norte");
  const [comoAdmin, comoUser] = conSucursales.tokens;
  const ids = (json: Record<string, unknown>) =>
    (json.data as { id: string }[]).map((f) => f.id).sort();

  for (const token of [comoAdmin, comoUser]) {
    const me = await pedir(conSucursales, "GET", "/api/me", undefined, token);
    assert.deepEqual(
      Object.keys(me.json).sort(),
      [...CLAVES_DE_ME_DE_HOY, "industry", "vocabulario", "rolesAsignables"].sort(),
    );
    // Turnos y conversaciones: de las dos sucursales, para los dos roles.
    const turnos = await pedir(conSucursales, "GET", "/api/bookings", undefined, token);
    assert.deepEqual(ids(turnos.json), [uno.bookingId, dos.bookingId].sort());
    const conversaciones = await pedir(
      conSucursales,
      "GET",
      "/api/conversations",
      undefined,
      token,
    );
    assert.deepEqual(ids(conversaciones.json), [uno.conversationId, dos.conversationId].sort());
    for (const path of [
      `/api/bookings/${dos.bookingId}`,
      `/api/conversations/${dos.conversationId}`,
    ]) {
      const r = await pedir(conSucursales, "GET", path, undefined, token);
      assert.equal(r.status, 200, path);
    }
  }

  // Tareas: el USER, solo las suyas; el ADMIN, todas. Con las claves de antes.
  const delUser = await pedir(conSucursales, "GET", "/api/activities", undefined, comoUser);
  assert.deepEqual(ids(delUser.json), [uno.tareaDelUser, dos.tareaDelUser].sort());
  const delAdmin = await pedir(conSucursales, "GET", "/api/activities", undefined, comoAdmin);
  assert.equal((delAdmin.json.data as unknown[]).length, 4);
  for (const tarea of [...(delUser.json.data as object[]), ...(delAdmin.json.data as object[])]) {
    assert.deepEqual(Object.keys(tarea).sort(), CLAVES_DE_TAREA_DE_HOY);
  }
  const una = await pedir(
    conSucursales,
    "GET",
    `/api/activities/${uno.tareaDelUser}`,
    undefined,
    comoUser,
  );
  assert.deepEqual(Object.keys(una.json).sort(), CLAVES_DE_TAREA_DE_HOY);

  // Usuarios e invitaciones (ADMIN): sin `branches`.
  const usuarios = await pedir(conSucursales, "GET", "/api/users", undefined, comoAdmin);
  assert.equal(usuarios.status, 200);
  for (const u of usuarios.json.data as Record<string, unknown>[]) {
    assert.equal("branches" in u, false);
    assert.equal("userBranches" in u, false);
  }
  const invitaciones = await pedir(conSucursales, "GET", "/api/invitations", undefined, comoAdmin);
  assert.equal(invitaciones.status, 200);

  // El 403 del USER en una ruta de ADMIN: el de siempre.
  const prohibido = await pedir(conSucursales, "GET", "/api/users", undefined, comoUser);
  assert.equal(prohibido.status, 403);
  assert.deepEqual(prohibido.json, {
    error: { message: "No tenés permisos para realizar esta acción" },
  });

  // Sin ninguna fila de usuarios por sede.
  assert.equal(await prisma.userBranch.count({ where: { organizationId: conSucursales.id } }), 0);
});
