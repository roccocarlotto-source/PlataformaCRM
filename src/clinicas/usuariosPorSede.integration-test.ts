import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { acceptInvitation } from "../services/invitation.service";

// ---------------------------------------------------------------------------
// Usuarios por sede contra la app real (docs/rubros.md §11.2, §11.4, §11.5,
// D19, PR R20).
//
// Una clínica con dos sedes (A y B) y cuatro personas: un ADMIN, una Recepción
// de la sede A, una de A y B, y una sin sedes. Cada sede tiene un turno, una
// conversación y una tarea; además hay una tarea sin sede. Una automotora con
// dos sucursales, un ADMIN y un USER, con lo mismo. Y una segunda clínica, para
// el aislamiento entre organizaciones.
//
//   - Recepción con la sede A no ve ni modifica nada de B (turnos,
//     conversaciones, tareas): 404. Con A y B ve las dos. Sin sedes, vacío.
//   - Los pacientes no tienen sede: toda Recepción los ve todos.
//   - Las tareas sin sede las ve y las toma cualquier Recepción.
//   - ADMIN de la clínica y los usuarios de la automotora: todo, como antes.
//   - Invitación con sedes: InvitationBranch, y al aceptar, UserBranch.
//   - Sedes en el formulario del usuario, con sus 400.
//   - Avisos por sede (§11.4) en la clínica; en la automotora, los de antes.
// ---------------------------------------------------------------------------

let clinica: OrgDePrueba;
let automotora: OrgDePrueba;
let otraClinica: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const emailsInvitados: string[] = [];

// Personas de la clínica, por posición en clinica.tokens / authIds.
const ADMIN = 0;
const RECEPCION_A = 1;
const RECEPCION_AB = 2;
const RECEPCION_SIN_SEDES = 3;
// De la automotora.
const USER = 1;

interface Sede {
  id: string;
  bookingId: string;
  conversationId: string;
  activityId: string;
  contactId: string;
}

interface Fixture {
  A: Sede;
  B: Sede;
  tareaSinSede: string;
}

let fxClinica: Fixture;
let fxAutomotora: Fixture;
let sedeDeOtraClinica: Sede;

const como = (org: OrgDePrueba, persona: number) => org.tokens[persona];

async function sedeConDatos(org: OrgDePrueba, nombre: string, adminId: string): Promise<Sede> {
  const branch = await createBranch(org.id, { name: nombre, timezone: "America/Montevideo" });
  const contacto = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Paciente", lastName: nombre },
  });
  const recurso = await prisma.resource.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: `Profesional ${nombre}`,
      type: "PERSON",
    },
  });
  const servicio = await prisma.serviceType.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      resourceId: recurso.id,
      name: `Consulta ${nombre}`,
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
      status: "TRANSFERRED_TO_HUMAN",
      assignedUserId: adminId,
    },
  });
  // Una tarea "de la sede": asignada al ADMIN, como la de un flujo de clínica
  // cuando la sede no tenía Recepción.
  const tarea = await prisma.activity.create({
    data: {
      organizationId: org.id,
      authorId: adminId,
      assigneeId: adminId,
      contactId: contacto.id,
      type: "TASK",
      subject: `Llamar a ${nombre}`,
      ...(org.industry === "CLINICA" ? { branchId: branch.id } : {}),
    },
  });
  return {
    id: branch.id,
    bookingId: turno.id,
    conversationId: conversacion.id,
    activityId: tarea.id,
    contactId: contacto.id,
  };
}

async function fixture(org: OrgDePrueba): Promise<Fixture> {
  const adminId = org.authIds[ADMIN];
  const A = await sedeConDatos(org, "Sede A", adminId);
  const B = await sedeConDatos(org, "Sede B", adminId);
  const sinSede = await prisma.activity.create({
    data: {
      organizationId: org.id,
      authorId: adminId,
      assigneeId: adminId,
      contactId: A.contactId,
      type: "TASK",
      subject: "Tarea manual sin sede",
    },
  });
  return { A, B, tareaSinSede: sinSede.id };
}

async function asignarSedes(org: OrgDePrueba, persona: number, sedes: string[]) {
  const userId = org.authIds[persona];
  await prisma.userBranch.deleteMany({ where: { organizationId: org.id, userId } });
  await prisma.userBranch.createMany({
    data: sedes.map((branchId) => ({ organizationId: org.id, userId, branchId })),
  });
}

function ids(json: Record<string, unknown>): string[] {
  return (json.data as { id: string }[]).map((f) => f.id).sort();
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("usuarios-por-sede", "COMPLETA", "CLINICA", 4);
  automotora = await crearOrgDePrueba("usuarios-por-sede", "COMPLETA", "AUTOMOTORA", 2);
  otraClinica = await crearOrgDePrueba("usuarios-por-sede", "COMPLETA", "CLINICA", 1);
  const [recepcion, usuario] = await Promise.all([
    findRoleByName("RECEPCION"),
    findRoleByName("USER"),
  ]);
  if (!recepcion || !usuario) throw new Error("Faltan los roles RECEPCION o USER");
  for (const persona of [RECEPCION_A, RECEPCION_AB, RECEPCION_SIN_SEDES]) {
    await prisma.user.update({
      where: { id: clinica.authIds[persona] },
      data: { roleId: recepcion.id },
    });
  }
  await prisma.user.update({
    where: { id: automotora.authIds[USER] },
    data: { roleId: usuario.id },
  });

  fxClinica = await fixture(clinica);
  fxAutomotora = await fixture(automotora);
  sedeDeOtraClinica = await sedeConDatos(otraClinica, "Sede Ajena", otraClinica.authIds[ADMIN]);

  await asignarSedes(clinica, RECEPCION_A, [fxClinica.A.id]);
  await asignarSedes(clinica, RECEPCION_AB, [fxClinica.A.id, fxClinica.B.id]);
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [clinica, automotora, otraClinica]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.userBranch.deleteMany({ where });
    await prisma.invitationBranch.deleteMany({ where });
    await prisma.invitation.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.branchBusinessHours.deleteMany({ where });
    // Los invitados que aceptaron quedaron como usuarios: borrarOrgDePrueba
    // borra todos los de la organización.
    await borrarOrgDePrueba(org);
  }
  for (const email of emailsInvitados) {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth.users WHERE email = ${email}`;
    for (const { id } of filas) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

// ---------------------------------------------------------------------------
// Recepción con la sede A
// ---------------------------------------------------------------------------

test("Recepción de la sede A: ve solo los turnos, conversaciones y tareas de A (más las suyas y las sin sede)", async () => {
  const token = como(clinica, RECEPCION_A);
  const turnos = await pedir(clinica, "GET", "/api/bookings", undefined, token);
  assert.equal(turnos.status, 200);
  assert.deepEqual(ids(turnos.json), [fxClinica.A.bookingId]);

  const conversaciones = await pedir(clinica, "GET", "/api/conversations", undefined, token);
  assert.equal(conversaciones.status, 200);
  assert.deepEqual(ids(conversaciones.json), [fxClinica.A.conversationId]);

  const tareas = await pedir(clinica, "GET", "/api/activities", undefined, token);
  assert.equal(tareas.status, 200);
  assert.deepEqual(ids(tareas.json), [fxClinica.A.activityId, fxClinica.tareaSinSede].sort());

  // Filtrar por la sede B (el selector de sede activa con una ajena): vacío.
  const filtradoB = await pedir(
    clinica,
    "GET",
    `/api/bookings?branchId=${fxClinica.B.id}`,
    undefined,
    token,
  );
  assert.deepEqual(ids(filtradoB.json), []);
});

test("Recepción de la sede A: todo lo de B es 404, para leer y para modificar", async () => {
  const token = como(clinica, RECEPCION_A);
  const B = fxClinica.B;
  const pedidos: [string, string, unknown][] = [
    ["GET", `/api/bookings/${B.bookingId}`, undefined],
    ["PATCH", `/api/bookings/${B.bookingId}/cancel`, {}],
    ["GET", `/api/conversations/${B.conversationId}`, undefined],
    ["PATCH", `/api/conversations/${B.conversationId}`, { brief: "x" }],
    ["POST", `/api/conversations/${B.conversationId}/close`, {}],
    ["POST", `/api/conversations/${B.conversationId}/messages`, { text: "Hola" }],
    ["POST", `/api/conversations/${B.conversationId}/return-to-agent`, {}],
    ["GET", `/api/activities/${B.activityId}`, undefined],
    ["PATCH", `/api/activities/${B.activityId}`, { completedAt: new Date().toISOString() }],
  ];
  for (const [metodo, path, body] of pedidos) {
    const r = await pedir(clinica, metodo, path, body, token);
    assert.equal(r.status, 404, `${metodo} ${path}: ${JSON.stringify(r.json)}`);
  }
  // Y nada cambió del lado de B.
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: B.bookingId } });
  assert.equal(turno.status, "CONFIRMED");
  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: B.conversationId },
  });
  assert.equal(conversacion.status, "TRANSFERRED_TO_HUMAN");
  const tarea = await prisma.activity.findUniqueOrThrow({ where: { id: B.activityId } });
  assert.equal(tarea.completedAt, null);
});

test("Recepción de la sede A: no agenda en un profesional de B (mismo error que uno inexistente)", async () => {
  const servicioB = await prisma.serviceType.findFirstOrThrow({
    where: { organizationId: clinica.id, branchId: fxClinica.B.id },
  });
  const r = await pedir(
    clinica,
    "POST",
    "/api/bookings",
    {
      resourceId: servicioB.resourceId,
      serviceTypeId: servicioB.id,
      contactId: fxClinica.B.contactId,
      startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    como(clinica, RECEPCION_A),
  );
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(
    (r.json.error as { message?: string } | undefined)?.message,
    "El recurso indicado no existe o no pertenece a tu organización",
  );
});

test("Recepción de la sede A: completa una tarea de A y toma una sin sede", async () => {
  const token = como(clinica, RECEPCION_A);
  const tomada = await pedir(
    clinica,
    "PATCH",
    `/api/activities/${fxClinica.tareaSinSede}`,
    { assigneeId: clinica.authIds[RECEPCION_A] },
    token,
  );
  assert.equal(tomada.status, 200, JSON.stringify(tomada.json));
  assert.equal(tomada.json.assigneeId, clinica.authIds[RECEPCION_A]);

  // Asignársela a otra persona sigue siendo de ADMIN.
  const aOtra = await pedir(
    clinica,
    "PATCH",
    `/api/activities/${fxClinica.A.activityId}`,
    { assigneeId: clinica.authIds[RECEPCION_AB] },
    token,
  );
  assert.equal(aOtra.status, 403, JSON.stringify(aOtra.json));

  const completada = await pedir(
    clinica,
    "PATCH",
    `/api/activities/${fxClinica.A.activityId}`,
    { completedAt: new Date().toISOString() },
    token,
  );
  assert.equal(completada.status, 200, JSON.stringify(completada.json));
  // Para que los demás tests vean la tarea pendiente.
  await prisma.activity.update({
    where: { id: fxClinica.A.activityId },
    data: { completedAt: null, confirmedAt: null, confirmedById: null },
  });
  await prisma.activity.update({
    where: { id: fxClinica.tareaSinSede },
    data: { assigneeId: clinica.authIds[ADMIN] },
  });
});

test("los pacientes no tienen sede: cualquier Recepción los ve todos", async () => {
  for (const persona of [RECEPCION_A, RECEPCION_SIN_SEDES]) {
    const r = await pedir(clinica, "GET", "/api/contacts", undefined, como(clinica, persona));
    assert.equal(r.status, 200);
    const vistos = ids(r.json);
    assert.ok(vistos.includes(fxClinica.A.contactId), `persona ${String(persona)} ve A`);
    assert.ok(vistos.includes(fxClinica.B.contactId), `persona ${String(persona)} ve B`);
  }
});

// ---------------------------------------------------------------------------
// Recepción con A y B, y sin sedes
// ---------------------------------------------------------------------------

test("Recepción de A y B: ve las dos sedes", async () => {
  const token = como(clinica, RECEPCION_AB);
  const turnos = await pedir(clinica, "GET", "/api/bookings", undefined, token);
  assert.deepEqual(ids(turnos.json), [fxClinica.A.bookingId, fxClinica.B.bookingId].sort());
  const conversaciones = await pedir(clinica, "GET", "/api/conversations", undefined, token);
  assert.deepEqual(
    ids(conversaciones.json),
    [fxClinica.A.conversationId, fxClinica.B.conversationId].sort(),
  );
  const tareaB = await pedir(
    clinica,
    "GET",
    `/api/activities/${fxClinica.B.activityId}`,
    undefined,
    token,
  );
  assert.equal(tareaB.status, 200);
});

test("Recepción sin sedes: turnos y conversaciones vacíos; de las tareas, solo las sin sede", async () => {
  const token = como(clinica, RECEPCION_SIN_SEDES);
  const turnos = await pedir(clinica, "GET", "/api/bookings", undefined, token);
  assert.equal(turnos.status, 200);
  assert.deepEqual(ids(turnos.json), []);
  const conversaciones = await pedir(clinica, "GET", "/api/conversations", undefined, token);
  assert.deepEqual(ids(conversaciones.json), []);
  const tareas = await pedir(clinica, "GET", "/api/activities", undefined, token);
  assert.deepEqual(ids(tareas.json), [fxClinica.tareaSinSede]);

  const me = await pedir(clinica, "GET", "/api/me", undefined, token);
  assert.deepEqual(me.json.sedes, []);
});

test("una sede borrada deja de contar: la Recepción de solo esa sede queda sin sedes", async () => {
  const sede = await createBranch(clinica.id, { name: "Sede Temporal", timezone: "UTC" });
  await asignarSedes(clinica, RECEPCION_SIN_SEDES, [sede.id]);
  const conSede = await pedir(
    clinica,
    "GET",
    "/api/me",
    undefined,
    como(clinica, RECEPCION_SIN_SEDES),
  );
  assert.deepEqual(conSede.json.sedes, [{ id: sede.id, name: "Sede Temporal" }]);

  await prisma.branch.update({ where: { id: sede.id }, data: { deletedAt: new Date() } });
  const sinSede = await pedir(
    clinica,
    "GET",
    "/api/me",
    undefined,
    como(clinica, RECEPCION_SIN_SEDES),
  );
  assert.deepEqual(sinSede.json.sedes, []);

  // El ADMIN la ve marcada en la lista de usuarios: sin sedes vigentes.
  const usuarios = await pedir(
    clinica,
    "GET",
    "/api/users?pageSize=100",
    undefined,
    como(clinica, ADMIN),
  );
  const fila = (usuarios.json.data as { id: string; branches: unknown[] }[]).find(
    (u) => u.id === clinica.authIds[RECEPCION_SIN_SEDES],
  );
  assert.deepEqual(fila?.branches, []);
  await prisma.userBranch.deleteMany({
    where: { organizationId: clinica.id, userId: clinica.authIds[RECEPCION_SIN_SEDES] },
  });
});

// ---------------------------------------------------------------------------
// ADMIN de la clínica y la automotora: todo, como antes
// ---------------------------------------------------------------------------

test("ADMIN de la clínica: ve todas las sedes; /me dice 'todas'", async () => {
  const token = como(clinica, ADMIN);
  const turnos = await pedir(clinica, "GET", "/api/bookings", undefined, token);
  assert.deepEqual(ids(turnos.json), [fxClinica.A.bookingId, fxClinica.B.bookingId].sort());
  const conversaciones = await pedir(clinica, "GET", "/api/conversations", undefined, token);
  assert.deepEqual(
    ids(conversaciones.json),
    [fxClinica.A.conversationId, fxClinica.B.conversationId].sort(),
  );
  const me = await pedir(clinica, "GET", "/api/me", undefined, token);
  assert.equal(me.json.sedes, "todas");
});

test("automotora: ADMIN y USER ven las dos sucursales; el USER, solo sus tareas; /me sin sedes", async () => {
  for (const persona of [ADMIN, USER]) {
    const token = como(automotora, persona);
    const turnos = await pedir(automotora, "GET", "/api/bookings", undefined, token);
    assert.deepEqual(
      ids(turnos.json),
      [fxAutomotora.A.bookingId, fxAutomotora.B.bookingId].sort(),
      `persona ${String(persona)}`,
    );
    const conversaciones = await pedir(automotora, "GET", "/api/conversations", undefined, token);
    assert.deepEqual(
      ids(conversaciones.json),
      [fxAutomotora.A.conversationId, fxAutomotora.B.conversationId].sort(),
    );
    const turnoB = await pedir(
      automotora,
      "GET",
      `/api/bookings/${fxAutomotora.B.bookingId}`,
      undefined,
      token,
    );
    assert.equal(turnoB.status, 200);
    const me = await pedir(automotora, "GET", "/api/me", undefined, token);
    assert.equal("sedes" in me.json, false);
  }
  // El USER: solo lo asignado a sí mismo (ninguna de las fixtures).
  const tareas = await pedir(
    automotora,
    "GET",
    "/api/activities",
    undefined,
    como(automotora, USER),
  );
  assert.deepEqual(ids(tareas.json), []);
  const ajena = await pedir(
    automotora,
    "GET",
    `/api/activities/${fxAutomotora.tareaSinSede}`,
    undefined,
    como(automotora, USER),
  );
  assert.equal(ajena.status, 404);
  // La lista de usuarios de una automotora no tiene la clave `branches`.
  const usuarios = await pedir(automotora, "GET", "/api/users", undefined, como(automotora, ADMIN));
  for (const u of usuarios.json.data as Record<string, unknown>[]) {
    assert.equal("branches" in u, false);
  }
  // Ni una fila de user_branches en la automotora.
  assert.equal(await prisma.userBranch.count({ where: { organizationId: automotora.id } }), 0);
});

test("automotora: branchIds se ignora en invitaciones y usuarios; un body con solo eso es el 400 de siempre", async () => {
  const email = `usuarios-por-sede-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  emailsInvitados.push(email);
  const invitacion = await pedir(
    automotora,
    "POST",
    "/api/invitations",
    { email, role: "USER", branchIds: [fxAutomotora.A.id] },
    como(automotora, ADMIN),
  );
  assert.equal(invitacion.status, 201, JSON.stringify(invitacion.json));
  assert.equal("branches" in invitacion.json, false);
  assert.equal(
    await prisma.invitationBranch.count({ where: { organizationId: automotora.id } }),
    0,
  );

  const soloSedes = await pedir(
    automotora,
    "PATCH",
    `/api/users/${automotora.authIds[USER]}`,
    { branchIds: [fxAutomotora.A.id] },
    como(automotora, ADMIN),
  );
  assert.equal(soloSedes.status, 400);
});

// ---------------------------------------------------------------------------
// Invitaciones y usuarios de la clínica
// ---------------------------------------------------------------------------

test("invitación de Recepción: sin sedes 400, con una sede de otra organización 400, ADMIN con sedes 400", async () => {
  const token = como(clinica, ADMIN);
  const email = () => {
    const e = `usuarios-por-sede-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
    emailsInvitados.push(e);
    return e;
  };
  const casos: [unknown, string][] = [
    [{ email: email(), role: "RECEPCION" }, "SEDES_OBLIGATORIAS"],
    [{ email: email(), role: "RECEPCION", branchIds: [] }, "SEDES_OBLIGATORIAS"],
    [{ email: email(), role: "RECEPCION", branchIds: [sedeDeOtraClinica.id] }, "SEDES_INVALIDAS"],
    [{ email: email(), role: "ADMIN", branchIds: [fxClinica.A.id] }, "ADMIN_SIN_SEDES"],
  ];
  for (const [body, code] of casos) {
    const r = await pedir(clinica, "POST", "/api/invitations", body, token);
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error?.code, code);
  }
  assert.equal(await prisma.invitation.count({ where: { organizationId: clinica.id } }), 0);
});

test("invitación con sedes: crea InvitationBranch y al aceptar pasan a UserBranch", async () => {
  const email = `usuarios-por-sede-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  emailsInvitados.push(email);
  const creada = await pedir(
    clinica,
    "POST",
    "/api/invitations",
    { email, role: "RECEPCION", branchIds: [fxClinica.B.id, fxClinica.A.id, fxClinica.A.id] },
    como(clinica, ADMIN),
  );
  assert.equal(creada.status, 201, JSON.stringify(creada.json));
  const invitationId = creada.json.id as string;
  assert.deepEqual(
    (creada.json.branches as { id: string }[]).map((b) => b.id).sort(),
    [fxClinica.A.id, fxClinica.B.id].sort(),
  );
  const filas = await prisma.invitationBranch.findMany({ where: { invitationId } });
  assert.deepEqual(filas.map((f) => f.branchId).sort(), [fxClinica.A.id, fxClinica.B.id].sort());

  // El listado de invitaciones de la clínica trae las sedes.
  const listado = await pedir(clinica, "GET", "/api/invitations", undefined, como(clinica, ADMIN));
  const fila = (listado.json.data as { id: string; branches: unknown[] }[]).find(
    (i) => i.id === invitationId,
  );
  assert.equal(fila?.branches.length, 2);

  // inviteUserByEmail ya creó la identidad en Supabase: se acepta con ella.
  const [identidad] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM auth.users WHERE email = ${email}`;
  const usuario = await acceptInvitation(
    { userId: identidad.id, email },
    { fullName: "Recepción Invitada", invitationId },
  );
  const sedes = await prisma.userBranch.findMany({ where: { userId: usuario.id } });
  assert.deepEqual(sedes.map((s) => s.branchId).sort(), [fxClinica.A.id, fxClinica.B.id].sort());
  assert.ok(sedes.every((s) => s.organizationId === clinica.id));
});

test("formulario del usuario: cambiar las sedes de una Recepción vale desde el próximo pedido", async () => {
  const persona = clinica.authIds[RECEPCION_A];
  const aB = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { branchIds: [fxClinica.B.id] },
    como(clinica, ADMIN),
  );
  assert.equal(aB.status, 200, JSON.stringify(aB.json));
  assert.deepEqual(aB.json.branches, [{ id: fxClinica.B.id, name: "Sede B" }]);
  const turnos = await pedir(
    clinica,
    "GET",
    "/api/bookings",
    undefined,
    como(clinica, RECEPCION_A),
  );
  assert.deepEqual(ids(turnos.json), [fxClinica.B.bookingId]);

  const vacio = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { branchIds: [] },
    como(clinica, ADMIN),
  );
  assert.equal(vacio.status, 400);
  assert.equal(vacio.json.error?.code, "SEDES_OBLIGATORIAS");
  const ajena = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { branchIds: [sedeDeOtraClinica.id] },
    como(clinica, ADMIN),
  );
  assert.equal(ajena.status, 400);
  assert.equal(ajena.json.error?.code, "SEDES_INVALIDAS");

  // Vuelve a A para el resto de la suite.
  await asignarSedes(clinica, RECEPCION_A, [fxClinica.A.id]);
});

test("un ADMIN no queda limitado por sede: pasar a ADMIN borra sus sedes, y pasar a Recepción las exige", async () => {
  const persona = clinica.authIds[RECEPCION_AB];
  const aAdminConSedes = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { role: "ADMIN", branchIds: [fxClinica.A.id] },
    como(clinica, ADMIN),
  );
  assert.equal(aAdminConSedes.status, 400);
  assert.equal(aAdminConSedes.json.error?.code, "ADMIN_SIN_SEDES");

  const aAdmin = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { role: "ADMIN" },
    como(clinica, ADMIN),
  );
  assert.equal(aAdmin.status, 200, JSON.stringify(aAdmin.json));
  assert.equal(await prisma.userBranch.count({ where: { userId: persona } }), 0);

  const aRecepcionSinSedes = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { role: "RECEPCION" },
    como(clinica, ADMIN),
  );
  assert.equal(aRecepcionSinSedes.status, 400);
  assert.equal(aRecepcionSinSedes.json.error?.code, "SEDES_OBLIGATORIAS");

  const deVuelta = await pedir(
    clinica,
    "PATCH",
    `/api/users/${persona}`,
    { role: "RECEPCION", branchIds: [fxClinica.A.id, fxClinica.B.id] },
    como(clinica, ADMIN),
  );
  assert.equal(deVuelta.status, 200, JSON.stringify(deVuelta.json));
  assert.equal(await prisma.userBranch.count({ where: { userId: persona } }), 2);
});

// ---------------------------------------------------------------------------
// Aislamiento entre organizaciones
// ---------------------------------------------------------------------------

test("aislamiento: una Recepción no alcanza nada de otra organización, ni con su id de sede", async () => {
  const token = como(clinica, RECEPCION_AB);
  for (const path of [
    `/api/bookings/${sedeDeOtraClinica.bookingId}`,
    `/api/conversations/${sedeDeOtraClinica.conversationId}`,
    `/api/activities/${sedeDeOtraClinica.activityId}`,
  ]) {
    const r = await pedir(clinica, "GET", path, undefined, token);
    assert.equal(r.status, 404, path);
  }
  const filtrado = await pedir(
    clinica,
    "GET",
    `/api/bookings?branchId=${sedeDeOtraClinica.id}`,
    undefined,
    token,
  );
  assert.deepEqual(ids(filtrado.json), []);
  // Una fila de user_branches que mezcla organizaciones la rechaza la FK compuesta.
  await assert.rejects(
    prisma.userBranch.create({
      data: {
        organizationId: clinica.id,
        userId: clinica.authIds[RECEPCION_A],
        branchId: sedeDeOtraClinica.id,
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// Avisos por sede (§11.4)
// ---------------------------------------------------------------------------

async function conversacionNueva(org: OrgDePrueba, branchId: string) {
  const agente = await prisma.agent.findFirstOrThrow({
    where: { organizationId: org.id, branchId },
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Aviso", lastName: randomUUID().slice(0, 8) },
  });
  return prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId,
      agentId: agente.id,
      contactId: contacto.id,
      channel: "WEB",
      status: "TRANSFERRED_TO_HUMAN",
      assignedUserId: org.authIds[ADMIN],
    },
  });
}

async function tareaSinRespuestaDe(org: OrgDePrueba, contactId: string) {
  return prisma.activity.findFirstOrThrow({
    where: { organizationId: org.id, contactId, type: "TASK" },
  });
}

test("aviso en una clínica: la tarea sin respuesta es de la sede y va a su Recepción con menos tareas abiertas", async () => {
  // RECEPCION_A tiene una tarea abierta más que RECEPCION_AB.
  await prisma.activity.create({
    data: {
      organizationId: clinica.id,
      authorId: clinica.authIds[ADMIN],
      assigneeId: clinica.authIds[RECEPCION_A],
      contactId: fxClinica.A.contactId,
      type: "TASK",
      subject: "Carga previa",
    },
  });
  const conversacion = await conversacionNueva(clinica, fxClinica.A.id);
  const r = await pedir(
    clinica,
    "POST",
    `/api/conversations/${conversacion.id}/return-to-agent`,
    {},
    como(clinica, ADMIN),
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const tarea = await tareaSinRespuestaDe(clinica, conversacion.contactId);
  assert.equal(tarea.branchId, fxClinica.A.id);
  assert.equal(tarea.assigneeId, clinica.authIds[RECEPCION_AB]);
});

test("aviso en una clínica: el Responsable por defecto de la sede, si es Recepción de esa sede", async () => {
  await prisma.branch.update({
    where: { id: fxClinica.A.id },
    data: { defaultOwnerId: clinica.authIds[RECEPCION_A] },
  });
  try {
    const conversacion = await conversacionNueva(clinica, fxClinica.A.id);
    const r = await pedir(
      clinica,
      "POST",
      `/api/conversations/${conversacion.id}/return-to-agent`,
      {},
      como(clinica, ADMIN),
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const tarea = await tareaSinRespuestaDe(clinica, conversacion.contactId);
    assert.equal(tarea.assigneeId, clinica.authIds[RECEPCION_A]);
    assert.equal(tarea.branchId, fxClinica.A.id);
  } finally {
    await prisma.branch.update({ where: { id: fxClinica.A.id }, data: { defaultOwnerId: null } });
  }
});

test("aviso en una automotora: la asignación es exactamente la de hoy (quien devuelve, si es ADMIN) y sin sede", async () => {
  const conversacion = await conversacionNueva(automotora, fxAutomotora.A.id);
  const r = await pedir(
    automotora,
    "POST",
    `/api/conversations/${conversacion.id}/return-to-agent`,
    {},
    como(automotora, ADMIN),
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const tarea = await tareaSinRespuestaDe(automotora, conversacion.contactId);
  assert.equal(tarea.assigneeId, automotora.authIds[ADMIN]);
  assert.equal(tarea.branchId, null);
});
