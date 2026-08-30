import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { InvitationStatus } from "@prisma/client";
import { env } from "../config/env";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import type { InvitationAcceptIdentity } from "../types/auth";
import { AppError } from "../utils/AppError";
import { acceptInvitationRowConditional } from "../repositories/invitation.repository";
import { acceptInvitation, createInvitation, revokeInvitation } from "./invitation.service";

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
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
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
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
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

function assertAppError(err: unknown, statusCode: number, message: string): true {
  assert.ok(err instanceof AppError, "debe ser AppError, no un error crudo");
  assert.equal((err as AppError).statusCode, statusCode);
  assert.equal((err as AppError).message, message);
  return true;
}

// ---------------------------------------------------------------------------
// createInvitation — únicamente las dos ramas que resuelven ANTES de llamar
// a Supabase (LOW-3). Esta suite no cubre el tramo
// createInvitation → inviteUserByEmail en sí: ese tramo depende de un envío
// real de email y Supabase limita ese envío a nivel de todo el proyecto
// (confirmado empíricamente, `over_email_send_rate_limit` — ver
// docs/project-overview.md secciones 8 y 9), así que no es seguro
// ejercitarlo desde un test persistente que puede correrse repetidas veces.
//
// Las dos ramas de abajo sí son seguras: ambas lanzan su AppError antes de
// que createInvitation llegue a insertar la fila de Invitation
// (invitation.service.ts, antes de createInvitationRepo), es decir también
// antes de getSupabaseAdmin()/inviteUserByEmail, que corren después en la
// misma función de forma estrictamente secuencial (un await tras otro, sin
// ramas paralelas ni reintentos). La prueba de que Supabase nunca fue
// invocado no se obtiene preguntándole a Supabase (eso consumiría el mismo
// cupo que se está evitando) sino observando el efecto real en Postgres:
// si no aparece ninguna fila nueva de Invitation para ese
// (organizationId, email), createInvitationRepo no corrió — y por lo tanto
// tampoco pudo correr inviteUserByEmail, que está después en el código.
// ---------------------------------------------------------------------------

test("createInvitation: email ya pertenece a un User existente → 409 antes de crear la Invitation ni tocar Supabase", async () => {
  const invitee = await createRealAuthUser("create-existing-user");
  await prisma.user.create({
    data: {
      id: invitee.id,
      organizationId: fx.orgId,
      roleId: fx.roleId,
      email: invitee.email,
      fullName: "Existing User",
    },
  });

  try {
    const before = await prisma.invitation.count({
      where: { organizationId: fx.orgId, email: invitee.email },
    });
    assert.equal(before, 0);

    await assert.rejects(
      () =>
        createInvitation(fx.orgId, fx.inviterId, {
          email: invitee.email,
          role: "USER",
        }),
      (err) => assertAppError(err, 409, "Ese email ya pertenece a un usuario existente"),
    );

    const after = await prisma.invitation.count({
      where: { organizationId: fx.orgId, email: invitee.email },
    });
    assert.equal(
      after,
      0,
      "no debe haberse creado ninguna Invitation: la función lanzó antes de createInvitationRepo y, por lo tanto, antes de inviteUserByEmail",
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: invitee.id } });
    await getSupabaseAdmin().auth.admin.deleteUser(invitee.id);
  }
});

test("createInvitation: ya existe una Invitation PENDING para ese email → 409 antes de crear una segunda ni tocar Supabase", async () => {
  const email = `low3-existing-pending-${randomUUID()}@example.test`;
  const existing = await createInvitationRow(email, "PENDING");

  const before = await prisma.invitation.count({
    where: { organizationId: fx.orgId, email },
  });
  assert.equal(before, 1);

  await assert.rejects(
    () => createInvitation(fx.orgId, fx.inviterId, { email, role: "USER" }),
    (err) => assertAppError(err, 409, "Ya existe una invitación pendiente para ese email"),
  );

  const after = await prisma.invitation.findMany({
    where: { organizationId: fx.orgId, email },
  });
  assert.equal(
    after.length,
    1,
    "no debe haberse creado una segunda Invitation: la función lanzó antes de createInvitationRepo y, por lo tanto, antes de inviteUserByEmail",
  );
  assert.equal(
    after[0].id,
    existing.id,
    "la única fila debe seguir siendo la preexistente, sin modificar",
  );
});

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
  // org2 necesita su propio inviter: `invitedBy` es quien envía la invitación
  // desde esa organización, así que tiene que pertenecer a ella. La FK
  // compuesta invitations_organization_id_invited_by_id_fkey (C-3, migración
  // 20260821140200) lo hace explícito — reusar el inviter de fx acá sería una
  // referencia cross-tenant, que es justo lo que esa FK vino a cerrar.
  const inviter2Auth = await createRealAuthUser("org2-inviter");
  try {
    const inviter2 = await prisma.user.create({
      data: {
        id: inviter2Auth.id,
        organizationId: org2.id,
        roleId: fx.roleId,
        email: inviter2Auth.email,
        fullName: "LOW1 Inviter org2",
      },
    });

    await createInvitationRow(email, "PENDING");
    // Índice único parcial es (organizationId, email) WHERE PENDING — dos
    // organizaciones distintas invitando el mismo email pueden estar
    // PENDING a la vez, sin violar esa constraint.
    await prisma.invitation.create({
      data: {
        organizationId: org2.id,
        email,
        roleId: fx.roleId,
        invitedById: inviter2.id,
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
    await prisma.user.deleteMany({ where: { organizationId: org2.id } });
    await prisma.organization.delete({ where: { id: org2.id } });
    await getSupabaseAdmin().auth.admin.deleteUser(inviter2Auth.id);
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
      assertAppError(err, 410, "Esta invitación venció, pedile a tu administrador que te reinvite"),
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
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada, no se puede revocar"),
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
    (err) => assertAppError(err, 410, "Esta invitación ya venció, no se puede revocar"),
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
//
// M-19 de docs/auditoria-2026-08-29.md: la sincronización entre la transacción
// A y la llamada real era por setTimeout (400 ms / 150 ms) — en un runner
// lento, flaky. Ahora A se sostiene por señal (src/lib/carreras.test-helper.ts)
// y se libera recién cuando Postgres confirma, vía pg_blocking_pids, que la
// escritura condicional de la llamada real está esperando el lock de fila que
// A sostiene. Eso fija además el matiz que importa: el pre-check rápido del
// service (un SELECT fuera de la transacción, MVCC) sigue viendo PENDING
// porque A no commiteó, así que la llamada llega hasta el CAS y es el CAS —
// no el pre-check— el que decide, al releer, que perdió.
// ---------------------------------------------------------------------------

// A: la transición rival (PENDING → ACCEPTED), sostenida sin commitear.
async function ganarTransicionSinCommitear(invitationId: string) {
  return sostenerTransaccion(async (tx) => {
    const result = await tx.invitation.updateMany({
      where: { id: invitationId, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    assert.equal(result.count, 1, "la transacción A debe ganar la transición real");
  });
}

test("acceptInvitation: pierde el CAS por una transición real concurrente → re-read reporta el estado ganador específico", async () => {
  const email = `low1-accept-cas-loss-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING");

  const a = await ganarTransicionSinCommitear(invitation.id);

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  const b = acceptInvitation(identity, { fullName: "Loser" });
  b.catch(() => undefined);
  // El pre-check de acceptInvitation ya pasó (vio PENDING); lo que está
  // esperando el lock es el UPDATE condicional dentro de su transacción.
  await esperarBloqueadoPor(a, b, "acceptInvitation");

  a.liberar();
  await a.terminada;

  await assert.rejects(
    () => b,
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada"),
  );
});

test("revokeInvitation: pierde el CAS por una transición real concurrente → re-read reporta el estado ganador específico", async () => {
  const email = `low1-revoke-cas-loss-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING");

  const a = await ganarTransicionSinCommitear(invitation.id);

  const b = revokeInvitation(fx.orgId, invitation.id);
  b.catch(() => undefined);
  await esperarBloqueadoPor(a, b, "revokeInvitation");

  a.liberar();
  await a.terminada;

  await assert.rejects(
    () => b,
    (err) => assertAppError(err, 409, "Esta invitación ya fue aceptada, no se puede revocar"),
  );
});

// ---------------------------------------------------------------------------
// M-11 (b), §28.7 de docs/bitacora-2026-08-29.md — "No se encontró el rol
// indicado" es un error de configuración del servidor (falta el seed) y va con
// isOperational: false. El logger.error del service ya deja el detalle.
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

test("M-11 b: createInvitation sin el rol en el catálogo lanza un AppError 500 NO operacional y no crea la Invitation", async () => {
  const email = `low1-sin-rol-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

  let capturado: unknown;
  await sinRolEnElCatalogo(async () => {
    try {
      await createInvitation(fx.orgId, fx.inviterId, { email, role: "USER" });
    } catch (err) {
      capturado = err;
    }
  });

  assert.ok(capturado instanceof AppError, String(capturado));
  assert.equal(capturado.statusCode, 500);
  assert.equal(capturado.isOperational, false);
  // El mensaje sigue intacto: es para el log.
  assert.equal(
    capturado.message,
    "No se encontró el rol indicado. Contactá al administrador del sistema.",
  );
  assert.equal(await prisma.invitation.count({ where: { organizationId: fx.orgId, email } }), 0);
});

// ---------------------------------------------------------------------------
// B-18 de docs/auditoria-2026-08-29.md — el CAS de aceptación revalida el
// vencimiento en su propia escritura (expires_at > clock_timestamp()).
// ---------------------------------------------------------------------------

test("B-18 (repository): el CAS no acepta una PENDING ya vencida — count 0 y la fila intacta", async () => {
  // Escritura directa por Prisma para saltear a propósito el
  // expireDueInvitations perezoso del service: la fila queda como la deja la
  // carrera real, PENDING con expiresAt en el pasado.
  const email = `b18-repo-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING", {
    expiresAt: new Date(Date.now() - 60_000),
  });

  const result = await acceptInvitationRowConditional(invitation.id);
  assert.equal(result.count, 0, "el CAS no debe aceptar una invitación vencida");

  const fila = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.equal(fila.status, "PENDING", "el CAS solo decide, no expira — eso es del caller");
  assert.equal(fila.acceptedAt, null);
});

test("B-18 (service, camino perezoso): aceptar una PENDING ya vencida da el 410 de vencimiento y deja la fila EXPIRED", async () => {
  // Acá quien ataja es el expireDueInvitations del arranque + el pre-check —
  // el contrato de siempre, fijado. La rama NUEVA del CAS fallido es el
  // fallback para la ventana que este fixture no puede producir (la fila ya
  // llega vencida al arranque); esa ventana la fuerza el test siguiente.
  const email = `b18-lazy-${randomUUID()}@example.test`;
  const invitation = await createInvitationRow(email, "PENDING", {
    expiresAt: new Date(Date.now() - 60_000),
  });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  await assert.rejects(
    () => acceptInvitation(identity, { fullName: "Tarde" }),
    (err) =>
      assertAppError(err, 410, "Esta invitación venció, pedile a tu administrador que te reinvite"),
  );

  const fila = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.equal(fila.status, "EXPIRED");
});

// El escenario COMPLETO del hallazgo —la fila vence ENTRE el pre-check y la
// ejecución del CAS— forzado de forma determinística. Tres piezas:
//
//   1. El pre-check corre con la expiración todavía en el futuro (margen
//      holgado contra la latencia de la base remota, pero por debajo del
//      timeout de 5 s de la transacción del service).
//   2. Una transacción A del test sostiene un TOUCH sobre la fila (update de
//      updatedAt, sin cambiar status): el CAS real se bloquea detrás. El touch
//      no es decorativo — Postgres evalúa el qual de un UPDATE antes de
//      bloquear, y solo RE-evalúa (EvalPlanQual) si al liberarse encuentra una
//      versión nueva de la fila; con un simple FOR UPDATE del otro lado, el
//      CAS aplicaría su decisión vieja (verificado empíricamente). Con el
//      touch, la re-evaluación corre sobre la versión nueva y
//      clock_timestamp() —volátil— se ejecuta fresco.
//   3. El test espera a que el RELOJ cruce expiresAt (espera por condición,
//      no una carrera: B sigue bloqueada por A mientras tanto) y recién ahí
//      libera A: el CAS re-evalúa, ve la fila vencida, da count 0, y la rama
//      nueva del service expira la fila y responde el 410 — después del
//      commit, así la expiración persiste.
test("B-18 (service, rama nueva): la invitación vence ENTRE el pre-check y el CAS → 410, no el 400 genérico, y la fila queda EXPIRED", async () => {
  const email = `b18-cas-${randomUUID()}@example.test`;
  const expiresAt = new Date(Date.now() + 2_500);
  const invitation = await createInvitationRow(email, "PENDING", { expiresAt });

  const a = await sostenerTransaccion(async (tx) => {
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { updatedAt: new Date() },
    });
  });

  const identity: InvitationAcceptIdentity = { userId: randomUUID(), email };
  const b = acceptInvitation(identity, { fullName: "Tarde" });
  b.catch(() => undefined);
  // El pre-check ya pasó (la expiración estaba en el futuro); lo que espera el
  // lock de A es el UPDATE del CAS.
  await esperarBloqueadoPor(a, b, "acceptInvitation (B-18)");

  while (Date.now() <= expiresAt.getTime()) {
    await new Promise((r) => setTimeout(r, 25));
  }

  a.liberar();
  await a.terminada;

  await assert.rejects(
    () => b,
    (err) =>
      assertAppError(err, 410, "Esta invitación venció, pedile a tu administrador que te reinvite"),
  );

  const fila = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.equal(fila.status, "EXPIRED", "la rama nueva expira la fila: no queda un PENDING zombie");
  assert.equal(await prisma.user.count({ where: { id: identity.userId } }), 0);
});
