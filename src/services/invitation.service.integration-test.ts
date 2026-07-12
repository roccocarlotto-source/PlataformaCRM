import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { InvitationStatus } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import type { InvitationAcceptIdentity } from "../types/auth";
import { AppError } from "../utils/AppError";
import { acceptInvitation, revokeInvitation } from "./invitation.service";

// Test de integración del LOW "accept/revoke de Invitation puede devolver
// 404/400 en vez del 409/410 más específico". Contra Postgres real, sin
// mocks — ejercita acceptInvitation/revokeInvitation directamente (no
// HTTP, esa capa ya está cubierta por otros tests) para poder controlar
// con precisión el estado real de cada Invitation.
//
// Los dos casos de "CAS perdido" (accept/revoke) NO usan una carrera real
// vía Promise.all esperando que gane quien gane — eso sería exactamente
// el tipo de test flaky que se pidió evitar. En cambio, una transacción A
// (prisma.$transaction) hace la transición real y mantiene el lock de
// fila de Postgres abierto, sin commitear, el tiempo justo — la lectura
// inicial del service (fuera de cualquier lock, MVCC/READ COMMITTED) ve
// el estado PENDING todavía vigente, pero su propia escritura condicional
// tiene que esperar a que A libere el lock. El resultado (quién gana, qué
// ve el re-read) queda determinado por un lock real de Postgres, no por
// timing de scheduling del proceso — es la misma primitiva que ya usa
// lockOrganizationForUpdate en producción (M3), no un hook nuevo.

async function createRealAuthUser(label: string) {
  const email = `low1-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`,
    );
  }
  return { id: data.user.id, email };
}

async function createRealAuthUserWithJwt(label: string) {
  const email = `low1-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = "Low1-test-password-123!";

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`,
    );
  }

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } =
    await anonClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.session) {
    throw new Error(
      `No se pudo iniciar sesión real (${label}): ${signInError?.message}`,
    );
  }

  return {
    authUserId: data.user.id,
    email,
    accessToken: signInData.session.access_token,
  };
}

interface Fixture {
  orgId: string;
  roleId: string;
  inviterId: string;
  inviterAuthId: string;
}

let fx: Fixture;

before(async () => {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `LOW1 org ${randomUUID()}`, slug: `low1-org-${Date.now()}` },
  });
  const inviterAuth = await createRealAuthUser("inviter");
  const inviter = await prisma.user.create({
    data: {
      id: inviterAuth.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: inviterAuth.email,
      fullName: "LOW1 Inviter",
    },
  });

  fx = {
    orgId: org.id,
    roleId: adminRole.id,
    inviterId: inviter.id,
    inviterAuthId: inviterAuth.id,
  };
});

after(async () => {
  if (!fx) return;
  await prisma.invitation.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.user.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.organization.delete({ where: { id: fx.orgId } });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.inviterAuthId);
});

function futureExpiry(days = 7): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createInvitationRow(
  email: string,
  status: InvitationStatus,
  opts: { createdAt?: Date; expiresAt?: Date } = {},
) {
  return prisma.invitation.create({
    data: {
      organizationId: fx.orgId,
      email,
      roleId: fx.roleId,
      invitedById: fx.inviterId,
      status,
      expiresAt: opts.expiresAt ?? futureExpiry(),
      createdAt: opts.createdAt,
      acceptedAt: status === "ACCEPTED" ? new Date() : undefined,
    },
  });
}

function assertAppError(
  err: unknown,
  statusCode: number,
  message: string,
): true {
  assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
  assert.equal((err as AppError).statusCode, statusCode);
  assert.equal((err as AppError).message, message);
  return true;
}

// ---------------------------------------------------------------------------
// acceptInvitation sin invitationId
// ---------------------------------------------------------------------------

test("acceptInvitation sin invitationId: email sin ninguna invitación → 404", async () => {
  const email = `low1-nonexistent-${randomUUID()}@example.test`;
  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };

  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "X" }),
    (err) => assertAppError(err, 404, "No se encontró ninguna invitación para tu email"),
  );
});

test("acceptInvitation sin invitationId: exactamente una PENDING → acepta con éxito", async () => {
  const invitee = await createRealAuthUserWithJwt("exactly-one-pending");
  try {
    await createInvitationRow(invitee.email, "PENDING");

    const identity: InvitationAcceptIdentity = {
      userId: invitee.authUserId,
      email: invitee.email,
    };
    const user = await acceptInvitation(identity, { fullName: "Exactly One" });
    assert.equal(user.id, invitee.authUserId);
  } finally {
    await prisma.user.deleteMany({ where: { id: invitee.authUserId } });
    await getSupabaseAdmin().auth.admin.deleteUser(invitee.authUserId);
  }
});

test("acceptInvitation sin invitationId: múltiples PENDING (distintas organizaciones) → 409 pidiendo invitationId explícito", async () => {
  const email = `low1-multi-pending-${randomUUID()}@example.test`;
  const org2 = await prisma.organization.create({
    data: { name: `LOW1 org2 ${randomUUID()}`, slug: `low1-org2-${Date.now()}` },
  });
  try {
    await createInvitationRow(email, "PENDING");
    // Índice único parcial es (organizationId, email) WHERE PENDING — dos
    // organizaciones distintas invitando el mismo email pueden estar
    // PENDING a la vez, sin violar esa constraint.
    await prisma.invitation.create({
      data: {
        organizationId: org2.id,
        email,
        roleId: fx.roleId,
        invitedById: fx.inviterId,
        status: "PENDING",
        expiresAt: futureExpiry(),
      },
    });

    const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
    await assert.rejects(
      () => acceptInvitation(identity, { fullName: "X" }),
      (err) =>
        assertAppError(
          err,
          409,
          "Hay más de una invitación pendiente para tu email — especificá invitationId",
        ),
    );
  } finally {
    await prisma.invitation.deleteMany({ where: { organizationId: org2.id } });
    await prisma.organization.delete({ where: { id: org2.id } });
  }
});

test("acceptInvitation sin invitationId: mezcla de históricas no-PENDING + una PENDING → acepta la PENDING sin importar recencia", async () => {
  const invitee = await createRealAuthUserWithJwt("mixed-pending-wins");
  try {
    // La PENDING es deliberadamente la más VIEJA de las tres por
    // createdAt — prueba que "hay exactamente una PENDING" gana sin
    // importar antigüedad relativa frente a las históricas.
    await createInvitationRow(invitee.email, "REVOKED", {
      createdAt: new Date(Date.now() - 1000),
    });
    await createInvitationRow(invitee.email, "PENDING", {
      createdAt: new Date(Date.now() - 5000),
    });
    await createInvitationRow(invitee.email, "EXPIRED", {
      createdAt: new Date(),
    });

    const identity: InvitationAcceptIdentity = {
      userId: invitee.authUserId,
      email: invitee.email,
    };
    const user = await acceptInvitation(identity, { fullName: "Mixed" });
    assert.equal(user.id, invitee.authUserId);
  } finally {
    await prisma.user.deleteMany({ where: { id: invitee.authUserId } });
    await getSupabaseAdmin().auth.admin.deleteUser(invitee.authUserId);
  }
});

test("acceptInvitation sin invitationId: ninguna PENDING, la más reciente es ACCEPTED → 409 específico", async () => {
  const email = `low1-none-pending-accepted-${randomUUID()}@example.test`;
  await createInvitationRow(email, "REVOKED", {
    createdAt: new Date(Date.now() - 10000),
  });
  await createInvitationRow(email, "ACCEPTED", { createdAt: new Date() });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "X" }),
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada"),
  );
});

test("acceptInvitation sin invitationId: ninguna PENDING, la más reciente es REVOKED → 410 específico", async () => {
  const email = `low1-none-pending-revoked-${randomUUID()}@example.test`;
  await createInvitationRow(email, "ACCEPTED", {
    createdAt: new Date(Date.now() - 10000),
  });
  await createInvitationRow(email, "REVOKED", { createdAt: new Date() });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "X" }),
    (err) =>
      assertAppError(
        err,
        410,
        "Esta invitación fue revocada, pedile a tu administrador que te reinvite",
      ),
  );
});

test("acceptInvitation sin invitationId: ninguna PENDING, la más reciente es EXPIRED → 410 específico", async () => {
  const email = `low1-none-pending-expired-${randomUUID()}@example.test`;
  await createInvitationRow(email, "REVOKED", {
    createdAt: new Date(Date.now() - 10000),
  });
  await createInvitationRow(email, "EXPIRED", { createdAt: new Date() });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "X" }),
    (err) =>
      assertAppError(
        err,
        410,
        "Esta invitación venció, pedile a tu administrador que te reinvite",
      ),
  );
});

test("acceptInvitation sin invitationId: selección determinística por createdAt DESC, no por orden de inserción", async () => {
  const email = `low1-createdat-order-${randomUUID()}@example.test`;
  // Insertada PRIMERO pero con createdAt más VIEJO — si el código
  // dependiera del orden natural de retorno de Postgres en vez de un
  // ORDER BY createdAt DESC explícito, este test detectaría la regresión.
  await createInvitationRow(email, "REVOKED", {
    createdAt: new Date(Date.now() - 60000),
  });
  // Insertada SEGUNDO pero con createdAt más NUEVO.
  await createInvitationRow(email, "ACCEPTED", { createdAt: new Date() });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "X" }),
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada"),
  );
});

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

test("revokeInvitation: PENDING → revoca con éxito", async () => {
  const email = `low1-revoke-pending-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING");

  const revoked = await revokeInvitation(fx.orgId, invitation.id);
  assert.equal(revoked.status, "REVOKED");
});

test("revokeInvitation: ACCEPTED → 409 específico, no el 400 genérico anterior", async () => {
  const email = `low1-revoke-accepted-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "ACCEPTED");

  await assert.rejects(
    () => revokeInvitation(fx.orgId, invitation.id),
    (err) =>
      assertAppError(
        err,
        409,
        "Esta invitación ya fue aceptada, no se puede revocar",
      ),
  );
});

test("revokeInvitation: REVOKED → 409 específico (error, no no-op idempotente)", async () => {
  const email = `low1-revoke-revoked-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "REVOKED");

  await assert.rejects(
    () => revokeInvitation(fx.orgId, invitation.id),
    (err) => assertAppError(err, 409, "Esta invitación ya fue revocada"),
  );
});

test("revokeInvitation: EXPIRED → 410 específico", async () => {
  const email = `low1-revoke-expired-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "EXPIRED");

  await assert.rejects(
    () => revokeInvitation(fx.orgId, invitation.id),
    (err) =>
      assertAppError(err, 410, "Esta invitación ya venció, no se puede revocar"),
  );
});

test("revokeInvitation: id inexistente → 404 (sin cambios)", async () => {
  await assert.rejects(
    () => revokeInvitation(fx.orgId, randomUUID()),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal((err as AppError).statusCode, 404);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// CAS perdido — carrera real forzada de forma determinística vía lock de
// Postgres, no Promise.all esperando quién gane.
// ---------------------------------------------------------------------------

test("acceptInvitation: pierde el CAS por una transición real concurrente → re-read reporta el estado ganador específico", async () => {
  const email = `low1-accept-cas-loss-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING");

  // Transacción A: gana la transición real (PENDING -> ACCEPTED) y
  // mantiene el lock de fila sin commitear el tiempo suficiente para que
  // la lectura inicial de acceptInvitation (MVCC, fuera de cualquier
  // lock) todavía vea PENDING, pero su propia escritura condicional tenga
  // que esperar a que A libere el lock.
  const txAPromise = prisma.$transaction(async (txA) => {
    const result = await txA.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    assert.equal(result.count, 1, "la transacción A debe ganar la transición real");
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  // Buffer generoso: asegura que A ya escribió (sin commitear) y sostiene
  // el lock antes de que arranque la llamada real al service.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "Loser" }),
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada"),
  );

  await txAPromise;
});

test("revokeInvitation: pierde el CAS por una transición real concurrente → re-read reporta el estado ganador específico", async () => {
  const email = `low1-revoke-cas-loss-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING");

  const txAPromise = prisma.$transaction(async (txA) => {
    const result = await txA.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    assert.equal(result.count, 1, "la transacción A debe ganar la transición real");
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  await new Promise((resolve) => setTimeout(resolve, 150));

  await assert.rejects(
    () => revokeInvitation(fx.orgId, invitation.id),
    (err) =>
      assertAppError(
        err,
        409,
        "Esta invitación ya fue aceptada, no se puede revocar",
      ),
  );

  await txAPromise;
});
