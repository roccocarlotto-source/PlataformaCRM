import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
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
    data: { id: authA.id, organizationId: org.id, roleId: adminRole.id, email: authA.email, fullName: "Admin A" },
  });
  const adminB = await prisma.user.create({
    data: { id: authB.id, organizationId: org.id, roleId: adminRole.id, email: authB.email, fullName: "Admin B" },
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

function assertExactlyOneWinsOneLoses(
  results: PromiseSettledResult<unknown>[],
  expectedMessage: string,
) {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "exactamente una de las dos operaciones concurrentes debe ganar");
  assert.equal(rejected.length, 1, "la otra debe perder, nunca ambas deben tener éxito");

  const loserReason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(loserReason instanceof AppError, "la perdedora debe ser un AppError, no un error crudo");
  assert.equal(loserReason.statusCode, 400);
  assert.equal(loserReason.message, expectedMessage);
}

async function assertExactlyOneActiveAdminRemains(organizationId: string) {
  const remaining = await prisma.user.count({
    where: { organizationId, isActive: true, deletedAt: null, role: { name: "ADMIN" } },
  });
  assert.equal(remaining, 1, "la organización debe conservar exactamente un ADMIN activo, nunca cero");
}

async function runRaceScenario(
  label: string,
  expectedMessage: string,
  operation: (
    orgId: string,
    actorId: string,
    targetId: string,
  ) => Promise<unknown>,
) {
  const scenario = await setupScenario(label);
  try {
    // adminA actúa (como ADMIN activo) sobre adminB; concurrentemente,
    // adminB actúa (como ADMIN activo) sobre adminA. Ninguna es
    // auto-modificación — el target de cada llamada es siempre el otro.
    const results = await Promise.allSettled([
      operation(scenario.orgId, scenario.adminA.id, scenario.adminB.id),
      operation(scenario.orgId, scenario.adminB.id, scenario.adminA.id),
    ]);

    assertExactlyOneWinsOneLoses(results, expectedMessage);
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
  );
});

test("updateUser(isActive=false) vs updateUser(isActive=false): adminA desactiva a adminB mientras adminB desactiva a adminA — nunca deja la organización sin ningún ADMIN", async () => {
  await runRaceScenario(
    "deactivate-deactivate",
    "No se puede modificar al último ADMIN activo de la organización",
    (orgId, actorId, targetId) => updateUser(orgId, actorId, targetId, { isActive: false }),
  );
});

test("degradación ADMIN→USER vs degradación ADMIN→USER: adminA degrada a adminB mientras adminB degrada a adminA — nunca deja la organización sin ningún ADMIN", async () => {
  await runRaceScenario(
    "demote-demote",
    "No se puede modificar al último ADMIN activo de la organización",
    (orgId, actorId, targetId) => updateUser(orgId, actorId, targetId, { role: "USER" }),
  );
});
