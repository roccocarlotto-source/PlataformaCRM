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

// ---------------------------------------------------------------------------
// El rol Recepción contra la app real (docs/rubros.md §11, PR R12).
//
// Una clínica con un ADMIN y una Recepción (la clínica y el rol se escriben
// directo en la base: hasta que CLINICA_HABILITADA esté en true no hay ruta
// que cree una clínica), y una automotora con un ADMIN y un USER.
//
//   - /api/me: el rol y los roles que se pueden asignar.
//   - El 400 cruzado entre rubros (ROL_NO_DISPONIBLE_EN_EL_RUBRO): invitar o
//     pasar a alguien a USER en la clínica, o a RECEPCION en la automotora.
//   - Recepción contra cada pantalla de §11.2: lo de configurar da 403; lo
//     operativo (pacientes, conversaciones, tareas, agenda) anda, incluido
//     lo que un USER no puede (editar un paciente ajeno, devolver al agente
//     una conversación asignada a otra persona). Con R20, Recepción trabaja
//     dentro de sus sedes: acá tiene la sede de cada fixture (el límite por
//     sede se prueba en usuariosPorSede.integration-test.ts).
// ---------------------------------------------------------------------------

let clinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const emailsInvitados: string[] = [];
// La sede de la clínica: invitar o pasar a alguien a Recepción exige sedes (R20).
let sedeDeLaClinica: { id: string };

// El token de cada persona: el primero es el ADMIN, el segundo la Recepción
// (o el USER en la automotora).
const comoAdmin = (org: OrgDePrueba) => org.tokens[0];
const comoOperativo = (org: OrgDePrueba) => org.tokens[1];

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("rol-recepcion", "COMPLETA", "CLINICA", 2);
  automotora = await crearOrgDePrueba("rol-recepcion", "COMPLETA", "AUTOMOTORA", 2);
  const [recepcion, usuario] = await Promise.all([
    findRoleByName("RECEPCION"),
    findRoleByName("USER"),
  ]);
  if (!recepcion || !usuario)
    throw new Error("Faltan los roles RECEPCION o USER (migración o seed)");
  await prisma.user.update({ where: { id: clinica.authIds[1] }, data: { roleId: recepcion.id } });
  await prisma.user.update({ where: { id: automotora.authIds[1] }, data: { roleId: usuario.id } });
  sedeDeLaClinica = await createBranch(clinica.id, {
    name: "Sede Principal",
    timezone: "America/Montevideo",
  });
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [clinica, automotora]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.userBranch.deleteMany({ where });
    await prisma.invitationBranch.deleteMany({ where });
    await prisma.invitation.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.clinicBranchSettings.deleteMany({ where });
    await prisma.branchBusinessHours.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
  for (const email of emailsInvitados) {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth.users WHERE email = ${email}`;
    for (const { id } of filas) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

const ROL_NO_DISPONIBLE = "ROL_NO_DISPONIBLE_EN_EL_RUBRO";

// ---------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------

test("/api/me: Recepción ve su rol, y la clínica asigna ADMIN y RECEPCION", async () => {
  const me = await pedir(clinica, "GET", "/api/me", undefined, comoOperativo(clinica));
  assert.equal(me.status, 200);
  assert.equal(me.json.role, "RECEPCION");
  assert.deepEqual(me.json.rolesAsignables, ["ADMIN", "RECEPCION"]);

  const deLaAutomotora = await pedir(
    automotora,
    "GET",
    "/api/me",
    undefined,
    comoAdmin(automotora),
  );
  assert.deepEqual(deLaAutomotora.json.rolesAsignables, ["ADMIN", "USER"]);
});

// ---------------------------------------------------------------------------
// El 400 cruzado entre rubros
// ---------------------------------------------------------------------------

test("invitaciones: USER en la clínica y RECEPCION en la automotora dan 400; RECEPCION en la clínica se invita", async () => {
  const email = () => {
    const e = `rol-recepcion-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
    emailsInvitados.push(e);
    return e;
  };
  const cruzados: [OrgDePrueba, string][] = [
    [clinica, "USER"],
    [automotora, "RECEPCION"],
  ];
  for (const [org, role] of cruzados) {
    const r = await pedir(
      org,
      "POST",
      "/api/invitations",
      { email: email(), role },
      comoAdmin(org),
    );
    assert.equal(r.status, 400, `${role}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, ROL_NO_DISPONIBLE);
  }
  const deLaClinica = await pedir(
    clinica,
    "POST",
    "/api/invitations",
    { email: email(), role: "RECEPCION", branchIds: [sedeDeLaClinica.id] },
    comoAdmin(clinica),
  );
  assert.equal(deLaClinica.status, 201, JSON.stringify(deLaClinica.json));
  const invitacion = await prisma.invitation.findFirstOrThrow({
    where: { organizationId: clinica.id },
    include: { role: true },
  });
  assert.equal(invitacion.role.name, "RECEPCION");
});

test("cambio de rol: pasar a USER en la clínica o a RECEPCION en la automotora da 400; dentro del rubro anda", async () => {
  const aUser = await pedir(
    clinica,
    "PATCH",
    `/api/users/${clinica.authIds[1]}`,
    { role: "USER" },
    comoAdmin(clinica),
  );
  assert.equal(aUser.status, 400);
  assert.equal(aUser.json.error?.code, ROL_NO_DISPONIBLE);

  const aRecepcion = await pedir(
    automotora,
    "PATCH",
    `/api/users/${automotora.authIds[1]}`,
    { role: "RECEPCION" },
    comoAdmin(automotora),
  );
  assert.equal(aRecepcion.status, 400);
  assert.equal(aRecepcion.json.error?.code, ROL_NO_DISPONIBLE);

  // Dentro del rubro: Recepción → ADMIN → Recepción.
  for (const role of ["ADMIN", "RECEPCION"]) {
    const r = await pedir(
      clinica,
      "PATCH",
      `/api/users/${clinica.authIds[1]}`,
      role === "RECEPCION" ? { role, branchIds: [sedeDeLaClinica.id] } : { role },
      comoAdmin(clinica),
    );
    assert.equal(r.status, 200, `${role}: ${JSON.stringify(r.json)}`);
  }
});

// ---------------------------------------------------------------------------
// Recepción contra las pantallas de §11.2
// ---------------------------------------------------------------------------

test("§11.2: Recepción no configura nada (403 en usuarios, invitaciones, agente, organización, sedes, agenda, borrar pacientes)", async () => {
  const id = randomUUID();
  const configuracion: [string, string, unknown][] = [
    ["PATCH", `/api/users/${id}`, { isActive: false }],
    ["POST", "/api/invitations", { email: "x@example.test", role: "RECEPCION" }],
    ["POST", "/api/agents", {}],
    ["POST", "/api/automations", {}],
    ["POST", "/api/knowledge-base", {}],
    ["PATCH", "/api/organization", {}],
    ["POST", "/api/branches", {}],
    ["POST", "/api/resources", {}],
    ["POST", "/api/service-types", {}],
    ["PUT", `/api/resources/${id}/working-hours`, {}],
    ["POST", `/api/branches/${id}/google-calendar/connect`, {}],
    ["DELETE", `/api/contacts/${id}`, undefined],
    ["POST", `/api/contacts/${id}/erase-personal-data`, {}],
    ["POST", `/api/contacts/${id}/merge`, {}],
  ];
  for (const [metodo, path, body] of configuracion) {
    const r = await pedir(clinica, metodo, path, body, comoOperativo(clinica));
    assert.equal(r.status, 403, `${metodo} ${path}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.message, "No tenés permisos para realizar esta acción");
  }
});

test("§11.2: Recepción crea y edita cualquier paciente, pero no se lo asigna a otra persona", async () => {
  const delAdmin = await prisma.contact.create({
    data: {
      organizationId: clinica.id,
      firstName: "Paciente",
      lastName: "Ejemplo",
      ownerId: clinica.authIds[0],
    },
  });
  const editado = await pedir(
    clinica,
    "PATCH",
    `/api/contacts/${delAdmin.id}`,
    { jobTitle: "Editado" },
    comoOperativo(clinica),
  );
  assert.equal(editado.status, 200, JSON.stringify(editado.json));

  const reasignado = await pedir(
    clinica,
    "PATCH",
    `/api/contacts/${delAdmin.id}`,
    { ownerId: clinica.authIds[0] },
    comoOperativo(clinica),
  );
  // Un ownerId que no es el suyo es asignarlo a otra persona: 403, como un USER.
  assert.equal(reasignado.status, 403);

  const creado = await pedir(
    clinica,
    "POST",
    "/api/contacts",
    { firstName: "Otra", lastName: "Paciente" },
    comoOperativo(clinica),
  );
  assert.equal(creado.status, 201, JSON.stringify(creado.json));

  // El mismo pedido de un USER de la automotora, sobre un contacto ajeno: 403.
  const ajeno = await prisma.contact.create({
    data: {
      organizationId: automotora.id,
      firstName: "Cliente",
      lastName: "Ejemplo",
      ownerId: automotora.authIds[0],
    },
  });
  const delUser = await pedir(
    automotora,
    "PATCH",
    `/api/contacts/${ajeno.id}`,
    { jobTitle: "Editado" },
    comoOperativo(automotora),
  );
  assert.equal(delUser.status, 403);
});

test("§11.2: Recepción devuelve al agente una conversación asignada a otra persona (un USER no)", async () => {
  async function conversacionAsignadaAlAdmin(org: OrgDePrueba) {
    const branch = await createBranch(org.id, {
      name: "Sede Centro",
      timezone: "America/Montevideo",
    });
    const contacto = await prisma.contact.create({
      data: { organizationId: org.id, firstName: "Ana", lastName: "Ejemplo" },
    });
    const agente = await prisma.agent.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        name: "Asistente",
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
        assignedUserId: org.authIds[0],
      },
    });
    // La Recepción atiende las conversaciones de sus sedes (R20).
    if (org.industry === "CLINICA") {
      await prisma.userBranch.create({
        data: { organizationId: org.id, userId: org.authIds[1], branchId: branch.id },
      });
    }
    return conversacion;
  }

  const deLaClinica = await conversacionAsignadaAlAdmin(clinica);
  const devuelta = await pedir(
    clinica,
    "POST",
    `/api/conversations/${deLaClinica.id}/return-to-agent`,
    {},
    comoOperativo(clinica),
  );
  assert.equal(devuelta.status, 200, JSON.stringify(devuelta.json));

  const deLaAutomotora = await conversacionAsignadaAlAdmin(automotora);
  const delUser = await pedir(
    automotora,
    "POST",
    `/api/conversations/${deLaAutomotora.id}/return-to-agent`,
    {},
    comoOperativo(automotora),
  );
  assert.equal(delUser.status, 403);

  const listado = await pedir(
    clinica,
    "GET",
    "/api/conversations",
    undefined,
    comoOperativo(clinica),
  );
  assert.equal(listado.status, 200);
});

test("§11.2: Recepción ve la agenda y sus tareas, y no le asigna una tarea a otra persona", async () => {
  for (const path of ["/api/bookings", "/api/resources", "/api/service-types", "/api/activities"]) {
    const r = await pedir(clinica, "GET", path, undefined, comoOperativo(clinica));
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  }
  const paciente = await prisma.contact.create({
    data: { organizationId: clinica.id, firstName: "Para", lastName: "Tarea" },
  });
  const propia = await pedir(
    clinica,
    "POST",
    "/api/activities",
    { type: "TASK", subject: "Llamar para confirmar", contactId: paciente.id },
    comoOperativo(clinica),
  );
  assert.equal(propia.status, 201, JSON.stringify(propia.json));

  const deOtro = await pedir(
    clinica,
    "POST",
    "/api/activities",
    {
      type: "TASK",
      subject: "Para el admin",
      contactId: paciente.id,
      assigneeId: clinica.authIds[0],
    },
    comoOperativo(clinica),
  );
  assert.equal(deOtro.status, 403, JSON.stringify(deOtro.json));
});
