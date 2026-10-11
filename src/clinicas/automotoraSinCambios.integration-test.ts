import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { vocabularioDe } from "../config/vocabulario";
import { prisma } from "../lib/prisma";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { crearRegistroDeHandlers } from "../services/outboxHandlers";
import { findRoleByName } from "../repositories/role.repository";
import { createBranch } from "../services/branch.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { cerrarTurnosVencidos } from "./services/atendido.service";
import { createAutomation } from "../services/automation.service";
import {
  INSTRUCCION_SOLO_LO_QUE_TE_CONSTA,
  runAgentTurn,
} from "../services/agentOrchestration.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "../services/llmProvider.service";
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
//
// Caso de R6 (bloqueos y sobreturnos): GET /api/availability de un USER sobre
// un recurso de cualquier sucursal sigue respondiendo, y recursos y reservas
// salen con las claves de antes (sin las columnas de sobreturnos).
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
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.message.deleteMany({ where });
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

// ---------------------------------------------------------------------------
// R6 (bloqueos y sobreturnos, docs/rubros.md §4.4 y §4.5).
// ---------------------------------------------------------------------------

const CLAVES_DE_RECURSO_DE_HOY = [
  "branchId",
  "createdAt",
  "deletedAt",
  "id",
  "name",
  "organizationId",
  "type",
  "updatedAt",
];

const CLAVES_DE_RESERVA_DE_HOY = [
  "branchId",
  "contactId",
  "createdAt",
  "endsAt",
  "googleEventId",
  "id",
  "opportunityId",
  "organizationId",
  "resourceId",
  "serviceTypeId",
  "startsAt",
  "status",
  "updatedAt",
];

test("R6: recursos y reservas con las claves de antes, y la disponibilidad genérica de un USER como siempre", async () => {
  const [comoAdmin, comoUser] = conSucursales.tokens;
  const recursos = await pedir(conSucursales, "GET", "/api/resources", undefined, comoAdmin);
  assert.equal(recursos.status, 200);
  const filas = recursos.json.data as Record<string, unknown>[];
  assert.ok(filas.length > 0, "la suite R20 dejó recursos");
  for (const r of filas) assert.deepEqual(Object.keys(r).sort(), CLAVES_DE_RECURSO_DE_HOY);

  const reservas = await pedir(conSucursales, "GET", "/api/bookings", undefined, comoUser);
  for (const b of reservas.json.data as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(b).sort(), CLAVES_DE_RESERVA_DE_HOY);
  }

  // Un USER de una automotora consulta la disponibilidad de un recurso de
  // cualquier sucursal (sin límite de sede).
  for (const recurso of filas) {
    const servicio = await prisma.serviceType.findFirstOrThrow({
      where: { organizationId: conSucursales.id, resourceId: recurso.id as string },
    });
    const desde = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const hasta = new Date(desde.getTime() + 7 * 24 * 60 * 60 * 1000);
    const r = await pedir(
      conSucursales,
      "GET",
      `/api/availability?resourceId=${recurso.id as string}&serviceTypeId=${servicio.id}&from=${desde.toISOString()}&to=${hasta.toISOString()}`,
      undefined,
      comoUser,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal(
    await prisma.resourceTimeOff.count({ where: { organizationId: conSucursales.id } }),
    0,
  );
});

// ---------------------------------------------------------------------------
// R9 (reprogramar, docs/rubros.md §4.7): una automotora no tiene reprogramar
// (la ruta es de agenda_clinica: 403 con motivo RUBRO), y archivar un recurso
// con turnos futuros es exactamente lo de antes: los turnos quedan como están y
// no se crea ninguna tarea.
// ---------------------------------------------------------------------------

test("R9: reprogramar da 403 RUBRO y archivar un recurso con turnos futuros no crea tareas", async () => {
  const [comoAdmin] = conSucursales.tokens;
  const sucursal = await prisma.branch.findFirstOrThrow({
    where: { organizationId: conSucursales.id, deletedAt: null },
  });
  const servicio = await prisma.serviceType.findFirstOrThrow({
    where: { organizationId: conSucursales.id, branchId: sucursal.id },
  });
  const contacto = await prisma.contact.findFirstOrThrow({
    where: { organizationId: conSucursales.id },
  });
  const archivable = await prisma.resource.create({
    data: {
      organizationId: conSucursales.id,
      branchId: sucursal.id,
      name: "Archivable",
      type: "PERSON",
    },
  });
  const inicio = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const turno = await prisma.booking.create({
    data: {
      organizationId: conSucursales.id,
      branchId: sucursal.id,
      serviceTypeId: servicio.id,
      resourceId: archivable.id,
      contactId: contacto.id,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + 30 * 60 * 1000),
    },
  });

  const reprogramar = await pedir(
    conSucursales,
    "PATCH",
    `/api/bookings/${turno.id}/reschedule`,
    { startsAt: new Date(inicio.getTime() + 60 * 60 * 1000).toISOString() },
    comoAdmin,
  );
  assert.equal(reprogramar.status, 403);
  assert.equal(reprogramar.json.error?.motivo, "RUBRO");

  const tareasAntes = await prisma.activity.count({ where: { organizationId: conSucursales.id } });
  const archivado = await pedir(
    conSucursales,
    "DELETE",
    `/api/resources/${archivable.id}`,
    undefined,
    comoAdmin,
  );
  assert.equal(archivado.status, 204, JSON.stringify(archivado.json));
  assert.equal(
    await prisma.activity.count({ where: { organizationId: conSucursales.id } }),
    tareasAntes,
  );
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.equal(despues.status, "CONFIRMED");
  assert.deepEqual(despues.startsAt, inicio);
});

// ---------------------------------------------------------------------------
// R10 (atendido, no vino y eventos del turno, docs/rubros.md §4.8): una
// automotora no emite ningún evento de turno al agendar ni al cancelar, el
// cierre automático nunca toca sus turnos, y las rutas de marcar son de clínica
// (403 con motivo RUBRO).
// ---------------------------------------------------------------------------

test("R10: agendar y cancelar en una automotora no emiten eventos, y el cierre automático no la toca", async () => {
  const [comoAdmin] = conSucursales.tokens;
  const recurso = await prisma.resource.findFirstOrThrow({
    where: { organizationId: conSucursales.id, deletedAt: null, serviceTypes: { some: {} } },
    include: { serviceTypes: true },
  });
  const contacto = await prisma.contact.findFirstOrThrow({
    where: { organizationId: conSucursales.id },
  });
  await replaceWorkingHoursForResource(conSucursales.id, recurso.id, [
    { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
  ]);
  const lunes = new Date("2027-03-08T12:00:00.000Z");
  const eventosAntes = await prisma.outboxEvent.count({
    where: { organizationId: conSucursales.id, eventType: { startsWith: "booking." } },
  });
  const creado = await pedir(
    conSucursales,
    "POST",
    "/api/bookings",
    {
      resourceId: recurso.id,
      serviceTypeId: recurso.serviceTypes[0].id,
      contactId: contacto.id,
      startsAt: lunes.toISOString(),
      force: true,
    },
    comoAdmin,
  );
  assert.equal(creado.status, 201, JSON.stringify(creado.json));
  const cancelado = await pedir(
    conSucursales,
    "PATCH",
    `/api/bookings/${creado.json.id as string}/cancel`,
    {},
    comoAdmin,
  );
  assert.equal(cancelado.status, 200);
  assert.equal(
    await prisma.outboxEvent.count({
      where: { organizationId: conSucursales.id, eventType: { startsWith: "booking." } },
    }),
    eventosAntes,
  );

  const viejo = await prisma.booking.create({
    data: {
      organizationId: conSucursales.id,
      branchId: recurso.branchId,
      serviceTypeId: recurso.serviceTypes[0].id,
      resourceId: recurso.id,
      contactId: contacto.id,
      startsAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
    },
  });
  await cerrarTurnosVencidos({ organizationId: conSucursales.id });
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: viejo.id } })).status,
    "CONFIRMED",
  );

  const marcar = await pedir(
    conSucursales,
    "PATCH",
    `/api/bookings/${viejo.id}/attended`,
    {},
    comoAdmin,
  );
  assert.equal(marcar.status, 403);
  assert.equal(marcar.json.error?.motivo, "RUBRO");
});

test("R11: el agente de una automotora no recibe las tools de turnos ni su texto, aunque enabledTools las nombre, y no puede ejecutarlas", async () => {
  const sucursal = await prisma.branch.findFirstOrThrow({
    where: { organizationId: conSucursales.id, deletedAt: null },
  });
  const contacto = await prisma.contact.create({
    data: {
      organizationId: conSucursales.id,
      firstName: "Cliente",
      lastName: "Ejemplo",
      phone: "+59899000009",
    },
  });
  const agente = await prisma.agent.create({
    data: {
      organizationId: conSucursales.id,
      branchId: sucursal.id,
      name: "Asistente",
      instructions: "Sos el asistente de la automotora.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [
        "get_availability",
        "get_contact_bookings",
        "reschedule_booking",
        "cancel_booking",
      ],
      channels: ["WHATSAPP"],
      guardrails: {} as Prisma.InputJsonValue,
      participation: "AUTONOMA",
      participationChosenAt: new Date(),
    },
  });
  const requests: LlmCompletionRequest[] = [];
  const respuestas: LlmCompletionResult[] = [
    {
      text: null,
      toolCalls: [
        {
          id: "c1",
          name: "cancel_booking",
          arguments: { bookingId: "11111111-1111-4111-8111-111111111111" },
        },
      ],
    },
    { text: "Te paso con una persona del equipo.", toolCalls: [] },
  ];
  const proveedor: LlmProvider = {
    name: "guionado",
    complete(request) {
      requests.push(request);
      return Promise.resolve(respuestas[Math.min(requests.length - 1, respuestas.length - 1)]);
    },
  };
  // El brief usa el proveedor global: el mismo doble, para no llamar a ningún modelo real.
  setLlmProviderForTests(proveedor);
  try {
    await runAgentTurn(
      {
        organizationId: conSucursales.id,
        agentId: agente.id,
        contactId: contacto.id,
        channel: "WHATSAPP",
        texto: "quiero cancelar mi turno",
        externalThreadId: "hilo-automotora-r11",
      },
      { llmProvider: proveedor },
    );
  } finally {
    resetLlmProviderParaTests();
  }
  assert.deepEqual(
    requests[0].tools.map((t) => t.name),
    ["get_availability", "request_human_handoff"],
  );
  assert.doesNotMatch(
    requests[0].systemPrompt,
    /get_contact_bookings|reschedule_booking|cancel_booking/,
  );
  assert.ok(requests[0].systemPrompt.includes(INSTRUCCION_SOLO_LO_QUE_TE_CONSTA));
  const saliente = await prisma.message.findFirstOrThrow({
    where: {
      organizationId: conSucursales.id,
      senderType: "AGENT",
      toolCalls: { not: Prisma.DbNull },
    },
  });
  const llamada = (saliente.toolCalls as { name: string; allowed?: boolean }[]).find(
    (t) => t.name === "cancel_booking",
  );
  assert.equal(llamada?.allowed, false, "una tool que no se ofreció no se ejecuta");
});

test("R13: una automotora no puede crear la regla del recordatorio (el 400 de siempre) y sus reservas no agendan recordatorios", async () => {
  await assert.rejects(
    createAutomation(conSucursales.id, {
      name: "Recordatorio",
      triggerType: "booking.reminder_due",
      actionType: "booking.send_reminder",
      actionConfig: { messageText: "Hola {nombre}, tu turno es el {dia} a las {hora}." },
    }),
    /triggerType "booking.reminder_due" no existe: debe ser uno de opportunity.won, opportunity.stale, contact.inquiry_stalled$/,
  );
  await assert.rejects(
    createAutomation(conSucursales.id, {
      name: "Recordatorio",
      triggerType: "opportunity.won",
      actionType: "booking.send_reminder",
      actionConfig: { messageText: "Hola {nombre}, tu turno es el {dia} a las {hora}." },
    }),
    (err: Error) =>
      err.message.startsWith('actionType "booking.send_reminder" no existe') &&
      !err.message.includes("booking.send_reminder,"),
  );
  assert.equal(
    await prisma.bookingMessage.count({ where: { organizationId: conSucursales.id } }),
    0,
  );
});

// ---------------------------------------------------------------------------
// R16 (aviso de privacidad, docs/rubros.md §8.1): una automotora no ve la fecha
// del aviso en sus contactos ni el aviso en su configuración, y no lo puede
// cargar (400).
// ---------------------------------------------------------------------------

test("R16: contactos y configuración de una automotora sin el aviso de privacidad, y cargarlo da 400", async () => {
  const [comoAdmin] = conSucursales.tokens;
  const contacto = await prisma.contact.create({
    data: { organizationId: conSucursales.id, firstName: "Cliente", lastName: "R16" },
  });
  const lista = await pedir(conSucursales, "GET", "/api/contacts", undefined, comoAdmin);
  assert.equal(lista.status, 200);
  for (const c of lista.json.data as Record<string, unknown>[]) {
    assert.ok(!("privacyNoticeSentAt" in c), "la lista no trae la fecha del aviso");
  }
  const uno = await pedir(
    conSucursales,
    "GET",
    `/api/contacts/${contacto.id}`,
    undefined,
    comoAdmin,
  );
  assert.equal(uno.status, 200);
  assert.ok(!("privacyNoticeSentAt" in uno.json));

  const config = await pedir(conSucursales, "GET", "/api/organization", undefined, comoAdmin);
  assert.equal(config.status, 200);
  assert.ok(!("privacyNoticeText" in config.json));
  assert.ok(!("privacyPolicyUrl" in config.json));

  const cargar = await pedir(
    conSucursales,
    "PATCH",
    "/api/organization",
    { privacyNoticeText: "Aviso" },
    comoAdmin,
  );
  assert.equal(cargar.status, 400);
  await prisma.contact.delete({ where: { id: contacto.id } });
});

test("R14: una automotora no puede usar booking.completed (el 400 de siempre) y sus servicios no traen el control", async () => {
  await assert.rejects(
    createAutomation(conSucursales.id, {
      name: "Reseña",
      triggerType: "booking.completed",
      actionType: "booking.send_qr_review",
      actionConfig: {},
    }),
    /triggerType "booking.completed" no existe: debe ser uno de opportunity.won, opportunity.stale, contact.inquiry_stalled$/,
  );
  const [comoAdmin] = conSucursales.tokens;
  const lista = await pedir(conSucursales, "GET", "/api/service-types", undefined, comoAdmin);
  assert.equal(lista.status, 200);
  for (const servicio of (lista.json.data as Record<string, unknown>[]) ?? []) {
    assert.equal("followUpAfterDays" in servicio, false);
  }
  const control = await pedir(
    conSucursales,
    "PUT",
    "/api/clinica/prestaciones/11111111-1111-4111-8111-111111111111/control",
    { followUpAfterDays: 10 },
    comoAdmin,
  );
  assert.equal(control.status, 403);
  assert.equal((control.json.error as { motivo?: string } | undefined)?.motivo, "RUBRO");
});

// ---------------------------------------------------------------------------
// Tarea después del turno (docs/rubros.md §7.3): la acción de siempre ahora
// también admite booking.completed, pero una automotora no tiene ese trigger:
// el 400 de siempre, y su tarea de venta ganada sigue igual.
// ---------------------------------------------------------------------------

test("§7.3: una automotora no puede colgar la tarea de booking.completed (el 400 de siempre)", async () => {
  await assert.rejects(
    createAutomation(conSucursales.id, {
      name: "Tarea después del turno",
      triggerType: "booking.completed",
      actionType: "activity.create_follow_up",
      actionConfig: { subject: "Llamar", daysUntilDue: 3 },
    }),
    /triggerType "booking.completed" no existe: debe ser uno de opportunity.won, opportunity.stale, contact.inquiry_stalled$/,
  );
  const registro = crearRegistroDeAcciones();
  registrarAutomatizaciones({ acciones: registro, handlers: crearRegistroDeHandlers() });
  const ganada = await createAutomation(
    conSucursales.id,
    {
      name: "Tarea de venta ganada",
      triggerType: "opportunity.won",
      actionType: "activity.create_follow_up",
      actionConfig: { subject: "Llamar para coordinar la entrega", daysUntilDue: 3 },
    },
    { registro },
  );
  assert.equal(ganada.triggerType, "opportunity.won");
  await prisma.automation.delete({ where: { id: ganada.id } });
});
