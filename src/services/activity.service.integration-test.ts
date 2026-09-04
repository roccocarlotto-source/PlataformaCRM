import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { updateActivity } from "./activity.service";

// Test de integración de T-1 (auditoría nueva): activities_related_entity_check
// puede violarse por una carrera real entre dos updateActivity concurrentes,
// cada uno limpiando una relación distinta — el resultado no era corrupción de
// datos (el CHECK de Postgres ya lo impedía), sino un PrismaClientUnknownRequestError
// sin traducir subiendo crudo hasta errorHandler.ts (500 en vez de 400).
//
// No alcanza con "A escribe, esperamos un rato, arrancamos el service": un
// AppError(400) puede salir de dos lugares distintos — el pre-check síncrono
// de updateActivity (si su lectura ve el companyId ya en null, comiteado por
// A) o la traducción nueva del CHECK (si su lectura todavía ve el estado
// previo a A, y su propia escritura choca contra el lock de A). Los dos
// producen el mismo AppError(400) con el mismo mensaje — indistinguibles
// por afuera si el test solo mira el resultado final.
//
// Para demostrar sin ambigüedad que se ejercitó el segundo camino (el que
// este fix protege), el test NUNCA deja que A comitee por tiempo: A queda
// abierta hasta que el propio test confirma, contra pg_stat_activity real,
// que algún backend está bloqueado específicamente por el pid de A
// (wait_event_type = 'Lock', causado por pg_blocking_pids). Esa señal solo
// puede existir si updateActivity ya emitió su UPDATE real (el pre-check no
// toca la base de forma que pueda producir un bloqueo) — así que, mientras
// A no comitee, es imposible que el pre-check síncrono haya sido el origen
// del resultado: bajo READ COMMITTED, ninguna otra transacción puede ver la
// escritura de A hasta que A comitea, así que la lectura de updateActivity
// siempre ve el estado previo (companyId todavía presente) y su propio
// chequeo siempre pasa, sin importar el timing exacto. Recién después de
// confirmar el bloqueo se libera a A.
//
// No es un hook agregado a producción ni un mock: es orquestación del lado
// del test sobre primitivas reales de Postgres (transacciones, locks de
// fila, y las vistas de sistema pg_stat_activity/pg_blocking_pids, ambas
// visibles con el rol de conexión de este proyecto, verificado
// empíricamente). Si el bloqueo nunca se detecta dentro del plazo, el test
// falla explícitamente en esa aserción — nunca sigue de largo silenciosamente.

async function createRealAuthUser(label: string) {
  const email = `t1-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

interface Fixture {
  orgId: string;
  userId: string;
  authUserId: string;
  // Dos USER reales (rol USER, no ADMIN) para los tests de self-service:
  // el assignee y otra persona de la misma organización.
  assigneeUserId: string;
  assigneeAuthUserId: string;
  otherUserId: string;
  otherAuthUserId: string;
  companyId: string;
  contactId: string;
}

let fx: Fixture;

before(async () => {
  const adminRole = await findRoleByName("ADMIN");
  const userRole = await findRoleByName("USER");
  if (!adminRole || !userRole) {
    throw new Error("No están sembrados los roles ADMIN/USER. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `T1 org ${randomUUID()}`, slug: `t1-org-${Date.now()}` },
  });
  const authUser = await createRealAuthUser("author");
  const user = await prisma.user.create({
    data: {
      id: authUser.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: authUser.email,
      fullName: "T1 Author",
    },
  });
  const assigneeAuth = await createRealAuthUser("assignee");
  const assignee = await prisma.user.create({
    data: {
      id: assigneeAuth.id,
      organizationId: org.id,
      roleId: userRole.id,
      email: assigneeAuth.email,
      fullName: "T1 Assignee",
    },
  });
  const otherAuth = await createRealAuthUser("other");
  const other = await prisma.user.create({
    data: {
      id: otherAuth.id,
      organizationId: org.id,
      roleId: userRole.id,
      email: otherAuth.email,
      fullName: "T1 Other",
    },
  });
  const company = await prisma.company.create({
    data: { organizationId: org.id, name: "T1 Company" },
  });
  const contact = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "T1", lastName: "Contact" },
  });

  fx = {
    orgId: org.id,
    userId: user.id,
    authUserId: authUser.id,
    assigneeUserId: assignee.id,
    assigneeAuthUserId: assigneeAuth.id,
    otherUserId: other.id,
    otherAuthUserId: otherAuth.id,
    companyId: company.id,
    contactId: contact.id,
  };
});

after(async () => {
  if (!fx) return;
  await prisma.activity.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.contact.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.company.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.user.deleteMany({ where: { organizationId: fx.orgId } });
  await prisma.organization.delete({ where: { id: fx.orgId } });
  for (const authUserId of [fx.authUserId, fx.assigneeAuthUserId, fx.otherAuthUserId]) {
    await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  }
});

// ---------------------------------------------------------------------------
// Self-service acotado de "Mis tareas": un USER puede completar (y
// destildar) SU actividad mandando solo completedAt; cualquier otra cosa es
// 403 y no escribe nada. La matriz completa de la regla pura está en
// activity.service.test.ts; acá se prueba con roles y filas reales que el
// service la aplica antes de tocar la base.
// ---------------------------------------------------------------------------

test("USER real completa su propia actividad mandando solo completedAt: persiste", async () => {
  const activity = await prisma.activity.create({
    data: {
      organizationId: fx.orgId,
      authorId: fx.userId,
      assigneeId: fx.assigneeUserId,
      type: "TASK",
      subject: "Mis tareas: propia",
      companyId: fx.companyId,
    },
  });
  const completedAt = new Date("2026-09-04T15:00:00.000Z");

  const updated = await updateActivity(
    fx.orgId,
    activity.id,
    { completedAt },
    { userId: fx.assigneeUserId, role: "USER" },
  );
  assert.equal(updated.completedAt?.toISOString(), completedAt.toISOString());

  const raw = await prisma.activity.findUnique({ where: { id: activity.id } });
  assert.equal(raw?.completedAt?.toISOString(), completedAt.toISOString());

  // Y la puede destildar (completedAt: null) con la misma regla.
  const reopened = await updateActivity(
    fx.orgId,
    activity.id,
    { completedAt: null },
    { userId: fx.assigneeUserId, role: "USER" },
  );
  assert.equal(reopened.completedAt, null);
});

test("USER real intentando completar la actividad de OTRO assignee: AppError 403 y nada escrito", async () => {
  const activity = await prisma.activity.create({
    data: {
      organizationId: fx.orgId,
      authorId: fx.userId,
      assigneeId: fx.assigneeUserId,
      type: "TASK",
      subject: "Mis tareas: ajena",
      companyId: fx.companyId,
    },
  });

  await assert.rejects(
    () =>
      updateActivity(
        fx.orgId,
        activity.id,
        { completedAt: new Date() },
        { userId: fx.otherUserId, role: "USER" },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError, "debe ser AppError");
      assert.equal(err.statusCode, 403);
      assert.equal(err.message, "No tenés permisos para realizar esta acción");
      return true;
    },
  );

  const raw = await prisma.activity.findUnique({ where: { id: activity.id } });
  assert.equal(raw?.completedAt, null, "no debe haberse escrito nada");
  assert.equal(raw?.updatedAt.toISOString(), activity.updatedAt.toISOString());
});

test("USER real que es el assignee pero manda otro campo además de completedAt: 403, nada escrito", async () => {
  const activity = await prisma.activity.create({
    data: {
      organizationId: fx.orgId,
      authorId: fx.userId,
      assigneeId: fx.assigneeUserId,
      type: "TASK",
      subject: "Mis tareas: sobrepaso",
      companyId: fx.companyId,
    },
  });

  await assert.rejects(
    () =>
      updateActivity(
        fx.orgId,
        activity.id,
        { completedAt: new Date(), subject: "Cambiado" },
        { userId: fx.assigneeUserId, role: "USER" },
      ),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );

  const raw = await prisma.activity.findUnique({ where: { id: activity.id } });
  assert.equal(raw?.subject, "Mis tareas: sobrepaso");
  assert.equal(raw?.completedAt, null);
});

test("updateActivity: carrera real limpiando companyId y contactId a la vez nunca deja las tres relaciones en null, y el perdedor recibe AppError(400) traducido del CHECK, no un error crudo", async () => {
  const activity = await prisma.activity.create({
    data: {
      organizationId: fx.orgId,
      authorId: fx.userId,
      type: "NOTE",
      subject: "T1 diag",
      companyId: fx.companyId,
      contactId: fx.contactId,
    },
  });

  let aPid: number | undefined;

  let signalTxAHasWritten: () => void;
  const txAHasWritten = new Promise<void>((resolve) => {
    signalTxAHasWritten = resolve;
  });

  let releaseA: () => void;
  const releaseASignal = new Promise<void>((resolve) => {
    releaseA = resolve;
  });

  // Transacción A: identifica su propio pid de Postgres, limpia companyId
  // de verdad, y mantiene el lock de fila abierto sin commitear hasta que
  // el test la libere explícitamente (nunca por tiempo). maxWait/timeout
  // generosos: el plazo real lo administra releaseASignal, no el timeout
  // por defecto de $transaction (5s), insuficiente para este polling.
  const txAPromise = prisma.$transaction(
    async (txA) => {
      const pidRow = await txA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      aPid = pidRow[0].pid;

      const result = await txA.activity.updateMany({
        where: { id: activity.id },
        data: { companyId: null },
      });
      assert.equal(result.count, 1, "la transacción A debe aplicar su propia escritura real");

      signalTxAHasWritten();

      await releaseASignal;
    },
    { maxWait: 15000, timeout: 15000 },
  );

  await txAHasWritten;
  assert.ok(aPid !== undefined, "debe conocerse el pid de la transacción A");

  // Arranco el service real, sin esperarlo todavía — su escritura, si
  // llega, va a quedar bloqueada por el lock de A.
  // fx.userId tiene rol ADMIN: este test es sobre la carrera del CHECK, no
  // sobre la autorización por recurso (esa tiene sus propios tests abajo).
  const servicePromise = updateActivity(
    fx.orgId,
    activity.id,
    { contactId: null },
    { userId: fx.userId, role: "ADMIN" },
  );
  // Evita un unhandledRejection mientras el polling de abajo mantiene la
  // promesa pendiente de resolución explícita más abajo (igual se
  // consume el resultado real con el try/catch de más abajo).
  servicePromise.catch(() => {});

  // Confirmo contra Postgres real, no por estimación, que la escritura de
  // updateActivity ya está bloqueada específicamente por A.
  let blocked = false;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (rows.length > 0) {
      blocked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.ok(
    blocked,
    "no se detectó ningún backend bloqueado por el lock de A dentro del plazo — no se puede afirmar que updateActivity alcanzó su escritura real (el pre-check no puede producir esta señal por sí solo)",
  );

  releaseA!();
  await txAPromise;

  let caught: unknown;
  try {
    await servicePromise;
    assert.fail("updateActivity debía rechazar — la fila queda sin ninguna relación");
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof AppError, "debe ser AppError, no un error crudo de Prisma");
  assert.equal((caught as AppError).statusCode, 400);
  assert.equal(
    (caught as AppError).message,
    "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
  );

  const raw = await prisma.activity.findUnique({ where: { id: activity.id } });
  assert.ok(raw, "la fila debe seguir existiendo");
  const allNull = !raw!.companyId && !raw!.contactId && !raw!.opportunityId;
  assert.equal(
    allNull,
    false,
    "el dato persistido nunca debe quedar con las tres relaciones en null a la vez",
  );
});
