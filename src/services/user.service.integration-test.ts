import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma, type Db } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { findRoleByName } from "../repositories/role.repository";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { deleteUser, updateUser } from "./user.service";
import { AppError } from "../utils/AppError";

// Test de integración: ejercita user.service + user.repository +
// organization.repository (lockOrganizationForUpdate) + Prisma reales
// contra la base de `.env` (Supabase real). No levanta Express — es un
// test de service, no un E2E HTTP: NO ejercita authorize("ADMIN") ni la
// frontera HTTP real. Lo que sí garantiza es que el estado inicial y los
// actores de cada operación son compatibles con las reglas reales de
// autorización del sistema (ambos actores son ADMIN activos, ninguna
// operación es auto-modificación) — eliminando el setup previo, imposible
// en producción, donde un actor USER operaba sobre dos ADMIN (un USER
// nunca pasaría authorize("ADMIN") en la ruta real).
//
// M3: dos operaciones concurrentes, cada una legítimamente autorizable
// (actor ADMIN activo, target distinto de sí mismo), quitando la condición
// de ADMIN activo a uno de los dos últimos ADMIN de una organización,
// podían — antes del fix — completar ambas y dejar la organización sin
// ningún ADMIN activo (confirmado empíricamente: ~29% de las corridas
// contra Postgres real, ver informe de M3). Con el locking explícito por
// Organization, el resultado debe ser SIEMPRE determinístico: exactamente
// una de las dos gana, la otra es rechazada con 400 — nunca ambas, nunca
// ninguna.
//
// Setup de cada escenario:
// - Exactamente 2 ADMIN activos al arrancar (adminA, adminB) — el mínimo
//   necesario para que el borde de la invariante ("al menos 1 debe
//   quedar") sea alcanzable por una carrera.
// - adminA actúa sobre adminB, y CONCURRENTEMENTE adminB actúa sobre
//   adminA — ambos actores son ADMIN activos al comenzar, ninguna de las
//   dos operaciones es auto-modificación (el target de cada una es el
//   OTRO admin, nunca el propio actor). countActiveAdmins excluye al
//   target, no al actor — por eso cada transacción, vista desde su propio
//   actor, cuenta al otro admin como "el que queda", que es exactamente el
//   borde de la invariante que hay que proteger.
// - Identidades reales en Supabase Auth (no filas fabricadas a mano): el
//   trigger trg_set_user_email_from_auth exige que auth.users exista.

async function createRealAuthUser(label: string) {
  const email = `m3-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

interface Scenario {
  orgId: string;
  adminA: { id: string };
  adminB: { id: string };
  authIds: string[];
}

async function setupScenario(label: string): Promise<Scenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `M3 ${label} ${randomUUID()}`, slug: `m3-${label}-${Date.now()}` },
  });

  const authA = await createRealAuthUser(`${label}-a`);
  const authB = await createRealAuthUser(`${label}-b`);

  const adminA = await prisma.user.create({
    data: {
      id: authA.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: authA.email,
      fullName: "Admin A",
    },
  });
  const adminB = await prisma.user.create({
    data: {
      id: authB.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: authB.email,
      fullName: "Admin B",
    },
  });

  return {
    orgId: org.id,
    adminA: { id: adminA.id },
    adminB: { id: adminB.id },
    authIds: [authA.id, authB.id],
  };
}

async function teardownScenario(scenario: Scenario) {
  await prisma.user.deleteMany({ where: { organizationId: scenario.orgId } });
  await prisma.organization.delete({ where: { id: scenario.orgId } });
  for (const authId of scenario.authIds) {
    await getSupabaseAdmin().auth.admin.deleteUser(authId);
  }
}

async function assertExactlyOneActiveAdminRemains(organizationId: string) {
  const remaining = await prisma.user.count({
    where: { organizationId, isActive: true, deletedAt: null, role: { name: "ADMIN" } },
  });
  assert.equal(
    remaining,
    1,
    "la organización debe conservar exactamente un ADMIN activo, nunca cero",
  );
}

// M-19 de docs/auditoria-2026-08-29.md — la carrera ya no se deja al azar del
// scheduler (Promise.allSettled detectaba el bug en ~29 % de las corridas: un
// PR que borrara lockOrganizationForUpdate pasaba CI 7 de 10 veces). Ahora:
//
//   A (control): la operación RIVAL —adminB actuando sobre adminA— reducida a
//     lo que aporta a la carrera: toma el MISMO lockOrganizationForUpdate que
//     toma el service y aplica su efecto (adminA deja de ser ADMIN activo),
//     sin commitear hasta que el test la libere.
//   B (real): adminA actuando sobre adminB, por el service de verdad. Su
//     lectura barata previa ve a adminA todavía activo (A no commiteó); su
//     transacción tiene que BLOQUEARSE en el lock. Postgres lo confirma vía
//     pg_blocking_pids; recién ahí se libera A, y B relee: adminA ya no cuenta
//     y adminB es el último → 400.
//
// Sin el lock, B no se bloquea, decide sobre el estado viejo y deja la
// organización sin ningún ADMIN — y el helper lo reporta como fallo
// determinista, no como una tasa.
async function runRaceScenario(
  label: string,
  expectedMessage: string,
  operation: (orgId: string, actorId: string, targetId: string) => Promise<unknown>,
  efectoRival: (tx: Db, rivalId: string) => Promise<void>,
) {
  const scenario = await setupScenario(label);
  try {
    const a = await sostenerTransaccion(async (tx) => {
      await lockOrganizationForUpdate(scenario.orgId, tx);
      await efectoRival(tx, scenario.adminA.id);
    });

    const b = operation(scenario.orgId, scenario.adminA.id, scenario.adminB.id);
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, label);

    a.liberar();
    await a.terminada;

    const resultado = await b.then(
      () => undefined,
      (err: unknown) => err,
    );
    assert.ok(
      resultado instanceof AppError,
      `${label}: la operación real debía rechazar con AppError tras releer; resultado: ${String(resultado)}`,
    );
    assert.equal(resultado.statusCode, 400);
    assert.equal(resultado.message, expectedMessage);

    await assertExactlyOneActiveAdminRemains(scenario.orgId);
  } finally {
    await teardownScenario(scenario);
  }
}

test("deleteUser vs deleteUser: adminA elimina a adminB mientras adminB elimina a adminA — nunca deja la organización sin ningún ADMIN", async () => {
  await runRaceScenario(
    "delete-delete",
    "No se puede eliminar al último ADMIN activo de la organización",
    (orgId, actorId, targetId) => deleteUser(orgId, actorId, targetId),
    // El efecto del deleteUser rival sobre adminA: soft delete.
    async (tx, rivalId) => {
      await tx.user.update({
        where: { id: rivalId },
        data: { deletedAt: new Date(), isActive: false },
      });
    },
  );
});

test("updateUser(isActive=false) vs updateUser(isActive=false): adminA desactiva a adminB mientras adminB desactiva a adminA — nunca deja la organización sin ningún ADMIN", async () => {
  await runRaceScenario(
    "deactivate-deactivate",
    "No se puede modificar al último ADMIN activo de la organización",
    (orgId, actorId, targetId) => updateUser(orgId, actorId, targetId, { isActive: false }),
    async (tx, rivalId) => {
      await tx.user.update({ where: { id: rivalId }, data: { isActive: false } });
    },
  );
});

test("degradación ADMIN→USER vs degradación ADMIN→USER: adminA degrada a adminB mientras adminB degrada a adminA — nunca deja la organización sin ningún ADMIN", async () => {
  await runRaceScenario(
    "demote-demote",
    "No se puede modificar al último ADMIN activo de la organización",
    (orgId, actorId, targetId) => updateUser(orgId, actorId, targetId, { role: "USER" }),
    async (tx, rivalId) => {
      const userRole = await findRoleByName("USER", tx);
      if (!userRole) throw new Error("No está sembrado el rol USER. Abortando.");
      await tx.user.update({ where: { id: rivalId }, data: { roleId: userRole.id } });
    },
  );
});

// ---------------------------------------------------------------------------
// M-11 (b), §28.7 de docs/bitacora-2026-08-29.md — "No se encontró el rol
// indicado" en updateUser es un error de configuración del servidor (falta el
// seed) y va con isOperational: false.
// ---------------------------------------------------------------------------

// CÓMO SE SIMULA "EL ROL NO ESTÁ EN EL CATÁLOGO" SIN TOCAR EL ROL REAL: la fila
// del rol es global y la leen en paralelo todos los archivos de integración;
// borrarla o renombrarla unos milisegundos es una fuente de fallos espurios en
// OTROS archivos. En cambio se reemplaza, solo en este proceso y solo durante
// la llamada, prisma.role.findUnique — que es exactamente lo que findRoleByName
// ejecuta — por una función que devuelve null, y se restaura en el finally.
// (mock.method de node:test no sirve acá: el delegate de Prisma es un Proxy
// que resuelve el método en el get, y mock.method no lo encuentra como
// propiedad; una asignación directa sí lo pisa.)
async function sinRolEnElCatalogo<T>(fn: () => Promise<T>): Promise<T> {
  const delegate = prisma.role as unknown as { findUnique: unknown };
  const original = delegate.findUnique;
  delegate.findUnique = async () => null;
  try {
    return await fn();
  } finally {
    delegate.findUnique = original;
  }
}

test("M-11 b: updateUser con un rol que no está en el catálogo lanza un AppError 500 NO operacional y no toca al usuario", async () => {
  const scenario = await setupScenario("m11-sin-rol");
  try {
    const antes = await prisma.user.findUniqueOrThrow({
      where: { id: scenario.adminB.id },
      select: { roleId: true },
    });

    let capturado: unknown;
    await sinRolEnElCatalogo(async () => {
      try {
        await updateUser(scenario.orgId, scenario.adminA.id, scenario.adminB.id, { role: "USER" });
      } catch (err) {
        capturado = err;
      }
    });

    assert.ok(capturado instanceof AppError, String(capturado));
    assert.equal(capturado.statusCode, 500);
    assert.equal(capturado.isOperational, false);
    assert.equal(capturado.message, "No se encontró el rol indicado");

    const despues = await prisma.user.findUniqueOrThrow({
      where: { id: scenario.adminB.id },
      select: { roleId: true },
    });
    assert.equal(despues.roleId, antes.roleId, "el rol del usuario no cambió");
  } finally {
    await teardownScenario(scenario);
  }
});
