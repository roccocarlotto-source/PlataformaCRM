import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { createBranch, getBranchById, updateBranch } from "./branch.service";
import { resolverOwnerDelContacto } from "./ownership.service";
import { assertAppError, capturar, desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// El vendedor por defecto por sucursal (ítem 69 de
// docs/frontend-cambios-pendientes.md) contra Postgres real: las dos mitades
// de la feature, que son las dos que no se pueden probar sin base.
//
//   A. CONFIGURARLO — branch.service.ts valida el defaultOwnerId contra users
//      antes de guardarlo (existe, misma organización, activo), y distingue
//      "no vino" de "vino en null" en el PATCH.
//   B. RESOLVERLO — resolverOwnerDelContacto (ownership.service.ts) decide el
//      ownerId efectivo de un contacto y, cuando lo toma de la sucursal, lo
//      PERSISTE en el Contact. Es la función que comparten los dos puntos de
//      consumo (create_opportunity y ejecutarHandoff); que esos dos caminos
//      completos funcionen se prueba en agentOrchestration.integration-test.ts.
//
// La forma de los schemas del borde (UUID opcional y nullable) está en
// branch.controller.test.ts, sin base.
//
// DOS ORGANIZACIONES REALES (vehicle.test-helper): A es la de trabajo, B solo
// existe para el caso cross-tenant — un usuario de B nunca puede ser el
// vendedor por defecto de una sucursal de A, ni siquiera mandando su UUID.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";
const UUID_INEXISTENTE = "99999999-9999-4999-8999-999999999999";

let a: Escenario;
let b: Escenario;
// Un segundo usuario activo de A, para el caso "se cambia de vendedor", y uno
// desactivado, para el caso que la validación tiene que rechazar.
let segundoUserId: string;
let desactivadoId: string;
const authIdsExtra: string[] = [];

before(async () => {
  a = await montar("branch-default-owner-a");
  b = await montar("branch-default-owner-b");

  const roleId = (await prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).roleId;
  segundoUserId = await crearUsuario(roleId, "Segundo Vendedor", true);
  desactivadoId = await crearUsuario(roleId, "Vendedor Desactivado", false);
});

// Un usuario más de A. CON identidad real en Supabase Auth aunque nunca se
// autentique: el trigger trg_set_user_email_from_auth completa users.email
// leyendo auth.users, así que una fila sin su par en auth queda con email NULL
// y viola el NOT NULL. Mismo motivo por el que vehicle.test-helper crea el ADMIN
// así.
async function crearUsuario(roleId: string, fullName: string, isActive: boolean) {
  const email = `bdo-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth: ${error?.message}`);
  }
  authIdsExtra.push(data.user.id);
  const user = await prisma.user.create({
    data: { id: data.user.id, organizationId: a.organizationId, roleId, email, fullName, isActive },
  });
  return user.id;
}

after(async () => {
  for (const e of [a, b]) {
    if (!e) continue;
    // Antes que los usuarios: contacts.owner_id es NO ACTION.
    await prisma.contact.deleteMany({ where: { organizationId: e.organizationId } });
  }
  await desmontar(a, b);
  for (const authId of authIdsExtra) {
    await getSupabaseAdmin().auth.admin.deleteUser(authId);
  }
});

function crearContacto(organizationId: string, ownerId: string | null) {
  return prisma.contact.create({
    data: { organizationId, firstName: "Ana", lastName: "Pérez", ownerId },
  });
}

// ---------------------------------------------------------------------------
// A. Configurar el vendedor por defecto
// ---------------------------------------------------------------------------

test("crear: con un vendedor activo de la organización, queda guardado", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Con vendedor",
    timezone: TZ,
    defaultOwnerId: a.userId,
  });
  assert.equal(branch.defaultOwnerId, a.userId);
  // Y se lee de vuelta desde la base, no solo del retorno del create.
  assert.equal((await getBranchById(a.organizationId, branch.id)).defaultOwnerId, a.userId);
});

test("crear: sin el campo, la sucursal nace sin vendedor por defecto — es un estado válido", async () => {
  const branch = await createBranch(a.organizationId, { name: "Sin vendedor", timezone: TZ });
  assert.equal(branch.defaultOwnerId, null);
});

test("crear: defaultOwnerId null explícito es lo mismo que no mandarlo", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Null explícito",
    timezone: TZ,
    defaultOwnerId: null,
  });
  assert.equal(branch.defaultOwnerId, null);
});

test("crear: un usuario de OTRA organización es 400 y no crea la sucursal", async () => {
  const antes = await prisma.branch.count({ where: { organizationId: a.organizationId } });
  const err = await capturar(() =>
    createBranch(a.organizationId, {
      name: "De otra org",
      timezone: TZ,
      defaultOwnerId: b.userId,
    }),
  );
  assertAppError(err, 400, "defaultOwnerId");
  assert.equal(await prisma.branch.count({ where: { organizationId: a.organizationId } }), antes);
});

test("crear: un usuario inexistente y uno desactivado son 400, con el mismo mensaje", async () => {
  for (const defaultOwnerId of [UUID_INEXISTENTE, desactivadoId]) {
    const err = await capturar(() =>
      createBranch(a.organizationId, { name: "Mala", timezone: TZ, defaultOwnerId }),
    );
    assertAppError(err, 400, "defaultOwnerId");
  }
});

test("editar: se puede poner, cambiar y sacar el vendedor por defecto", async () => {
  const branch = await createBranch(a.organizationId, { name: "Editable", timezone: TZ });
  assert.equal(branch.defaultOwnerId, null);

  const conVendedor = await updateBranch(a.organizationId, branch.id, {
    defaultOwnerId: a.userId,
  });
  assert.equal(conVendedor.defaultOwnerId, a.userId);

  const cambiado = await updateBranch(a.organizationId, branch.id, {
    defaultOwnerId: segundoUserId,
  });
  assert.equal(cambiado.defaultOwnerId, segundoUserId);

  // null desvincula: la sucursal vuelve a no tener ninguno.
  const sinVendedor = await updateBranch(a.organizationId, branch.id, { defaultOwnerId: null });
  assert.equal(sinVendedor.defaultOwnerId, null);
});

test("editar: no mandar el campo NO lo toca — un PATCH de nombre no borra el vendedor", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Intacta",
    timezone: TZ,
    defaultOwnerId: a.userId,
  });

  const renombrada = await updateBranch(a.organizationId, branch.id, { name: "Renombrada" });

  assert.equal(renombrada.name, "Renombrada");
  assert.equal(renombrada.defaultOwnerId, a.userId, "el vendedor tiene que seguir ahí");
});

test("editar: un vendedor inválido es 400 y deja el que ya estaba", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "No se pisa",
    timezone: TZ,
    defaultOwnerId: a.userId,
  });

  for (const defaultOwnerId of [b.userId, UUID_INEXISTENTE, desactivadoId]) {
    const err = await capturar(() => updateBranch(a.organizationId, branch.id, { defaultOwnerId }));
    assertAppError(err, 400, "defaultOwnerId");
  }

  assert.equal((await getBranchById(a.organizationId, branch.id)).defaultOwnerId, a.userId);
});

// ---------------------------------------------------------------------------
// B. Resolver el vendedor efectivo de un contacto
// ---------------------------------------------------------------------------

test("contacto que YA tiene vendedor: devuelve ese, sin mirar la sucursal", async () => {
  // La sucursal tiene otro vendedor por defecto a propósito: si la función lo
  // prefiriera, este test lo vería.
  const branch = await createBranch(a.organizationId, {
    name: "Con default distinto",
    timezone: TZ,
    defaultOwnerId: segundoUserId,
  });
  const contact = await crearContacto(a.organizationId, a.userId);

  const resuelto = await resolverOwnerDelContacto(a.organizationId, branch.id, contact);

  assert.equal(resuelto, a.userId);
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(despues.ownerId, a.userId, "el dueño real no se toca");
});

test("contacto sin vendedor + sucursal con default vigente: lo devuelve Y lo persiste en el Contact", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Con default vigente",
    timezone: TZ,
    defaultOwnerId: a.userId,
  });
  const contact = await crearContacto(a.organizationId, null);

  const resuelto = await resolverOwnerDelContacto(a.organizationId, branch.id, contact);

  assert.equal(resuelto, a.userId);
  // Lo que distingue este ítem de un "dueño provisorio": el Contact queda
  // asignado de verdad, y a partir de acá aparece así en Contactos.
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(despues.ownerId, a.userId);
});

test("contacto sin vendedor + sucursal SIN default: null, y el Contact sigue sin nadie", async () => {
  const branch = await createBranch(a.organizationId, { name: "Sin default", timezone: TZ });
  const contact = await crearContacto(a.organizationId, null);

  const resuelto = await resolverOwnerDelContacto(a.organizationId, branch.id, contact);

  assert.equal(resuelto, null);
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(despues.ownerId, null);
});

test("el default apunta a un usuario ya desactivado: se trata como si no hubiera ninguno", async () => {
  // Se configura con el usuario activo y se lo desactiva DESPUÉS: es el camino
  // real (la validación del service no deja guardar uno desactivado, pero nada
  // impide desactivarlo al día siguiente, y la FK es NO ACTION).
  const branch = await createBranch(a.organizationId, {
    name: "Default que caducó",
    timezone: TZ,
    defaultOwnerId: segundoUserId,
  });
  await prisma.user.update({ where: { id: segundoUserId }, data: { isActive: false } });
  const contact = await crearContacto(a.organizationId, null);

  try {
    const resuelto = await resolverOwnerDelContacto(a.organizationId, branch.id, contact);

    assert.equal(resuelto, null, "un vendedor desactivado no puede ser dueño de nada");
    const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    assert.equal(despues.ownerId, null, "el Contact no se toca");
  } finally {
    await prisma.user.update({ where: { id: segundoUserId }, data: { isActive: true } });
  }
});

test("una sucursal que no existe no tumba nada: devuelve null como si no tuviera default", async () => {
  // Tolerancia: el llamador es un turno del agente de IA, y ninguna lectura de
  // este módulo puede convertirse en una excepción que corte la conversación.
  const contact = await crearContacto(a.organizationId, null);

  const resuelto = await resolverOwnerDelContacto(a.organizationId, UUID_INEXISTENTE, contact);

  assert.equal(resuelto, null);
});
