import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { lockPipelineForUpdate } from "../repositories/pipeline.repository";
import { findRoleByName } from "../repositories/role.repository";
import { lockStageForUpdate } from "../repositories/stage.repository";
import { AppError } from "../utils/AppError";
import { createOpportunity } from "./opportunity.service";
import { createPipeline, deletePipeline } from "./pipeline.service";
import { createStage, deleteStage } from "./stage.service";

// ALTO-8 — RESTRICT lógico en las dos relaciones que el hallazgo señala:
// Stage -> Opportunity y Pipeline -> Stage.
//
// El patrón de MARCADO del soft delete siempre estuvo bien (los 6 buildWhere
// incluyen deletedAt: null). Lo que no había era ninguna cascada NI ningún
// bloqueo, y los onDelete de las migraciones son decorativos porque nada se
// borra físicamente jamás. Dos consecuencias concretas:
//
//   1. Un Stage borrado con oportunidades vivas: seguían contando en los
//      totales pero desaparecían del tablero, que se arma por stages activos.
//      Los números del pipeline dejaban de cuadrar con las columnas.
//   2. Un Pipeline borrado con stages vivos: findManyStages no filtra por el
//      estado del pipeline, así que sin filters.pipelineId los stages
//      huérfanos aparecían en el listado de la organización.
//
// Se eligió BLOQUEAR (opción B del hallazgo), no cascadear: mismo criterio y
// mismo formato de error que "el último pipeline". Filtrar en lectura por el
// estado del padre (opción C) está descartado por la auditoría misma.
//
// ---------------------------------------------------------------------------
// POR QUÉ HAY TESTS DE CARRERA Y NO SOLO DE CAMINO FELIZ
// ---------------------------------------------------------------------------
//
// Un RESTRICT es una decisión sobre un CONTEO, y un conteo sin punto de
// serialización no decide nada: entre leerlo y escribir, otra transacción
// inserta la fila que lo habría cambiado. Es exactamente H-1 otra vez. Los dos
// tests de carrera son los que prueban que el bloqueo no es evitable con solo
// llegar primero — sin ellos, los tests secuenciales pasarían igual con los
// locks sacados, y el chequeo sería decorativo.
//
// Como en los tests de carrera de M3/H-1: Promise.allSettled no fuerza un
// interleaving concreto, así que esto es un test de invariante — afirma que
// NINGÚN resultado posible deja un huérfano — no un reproductor determinista
// del bug. La aserción final es sobre el estado de la base, no sobre cuál de
// las dos operaciones ganó.

interface Escenario {
  orgId: string;
  userId: string;
  authIds: string[];
  companyId: string;
}

async function crearAuthUser(etiqueta: string) {
  const email = `alto8-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear usuario real de Supabase Auth (${etiqueta}): ${error?.message}`,
    );
  }
  return data.user.id;
}

// Identidad real en Supabase Auth, no una fila fabricada: el trigger
// trg_set_user_email_from_auth lee auth.users para completar users.email, que
// es NOT NULL. Mismo motivo que en user.service.integration-test.ts.
async function montar(etiqueta: string): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `ALTO-8 ${etiqueta} ${randomUUID()}`, slug: `alto8-${etiqueta}-${Date.now()}` },
  });

  const authId = await crearAuthUser(etiqueta);
  const user = await prisma.user.create({
    data: {
      id: authId,
      organizationId: org.id,
      roleId: adminRole.id,
      email: `placeholder-${authId}@example.test`,
      fullName: `ALTO-8 ${etiqueta}`,
    },
  });

  // Opportunity tiene un CHECK que exige companyId o contactId.
  const company = await prisma.company.create({
    data: { organizationId: org.id, name: `ALTO-8 company ${randomUUID()}` },
  });

  return { orgId: org.id, userId: user.id, authIds: [authId], companyId: company.id };
}

async function desmontar(escenario: Escenario) {
  await prisma.opportunity.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.stage.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.company.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.user.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.organization.delete({ where: { id: escenario.orgId } });
  for (const authId of escenario.authIds) {
    await getSupabaseAdmin().auth.admin.deleteUser(authId);
  }
}

function assertAppError(err: unknown, statusCode: number, message: string) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  assert.equal(err.message, message);
}

// ---------------------------------------------------------------------------
// Escenario 1 — Stage -> Opportunity
// ---------------------------------------------------------------------------

test("deleteStage rechaza con 400 si la etapa tiene oportunidades activas, y la etapa sigue viva", async () => {
  const escenario = await montar("stage-restrict");
  try {
    const pipeline = await createPipeline(escenario.orgId, { name: "P" });
    const stage = await createStage(escenario.orgId, { pipelineId: pipeline.id, name: "S1" });

    await createOpportunity(escenario.orgId, escenario.userId, {
      title: "Oportunidad viva",
      pipelineId: pipeline.id,
      stageId: stage.id,
      companyId: escenario.companyId,
    });

    let capturado: unknown;
    try {
      await deleteStage(escenario.orgId, stage.id);
      assert.fail("deleteStage debía rechazar: la etapa tiene una oportunidad activa");
    } catch (err) {
      capturado = err;
    }

    assertAppError(
      capturado,
      400,
      "No se puede eliminar una etapa que tiene oportunidades activas. Movelas a otra etapa primero.",
    );

    // Que el rechazo no haya dejado el borrado a medias.
    const persistida = await prisma.stage.findUnique({ where: { id: stage.id } });
    assert.equal(persistida?.deletedAt, null, "la etapa no debe quedar borrada tras el rechazo");
  } finally {
    await desmontar(escenario);
  }
});

test("deleteStage procede cuando la única oportunidad de la etapa ya está borrada — el bloqueo mira deletedAt, no la existencia", async () => {
  const escenario = await montar("stage-permite");
  try {
    const pipeline = await createPipeline(escenario.orgId, { name: "P" });
    const stage = await createStage(escenario.orgId, { pipelineId: pipeline.id, name: "S1" });

    const oportunidad = await createOpportunity(escenario.orgId, escenario.userId, {
      title: "Oportunidad que se borra",
      pipelineId: pipeline.id,
      stageId: stage.id,
      companyId: escenario.companyId,
    });

    await prisma.opportunity.update({
      where: { id: oportunidad.id },
      data: { deletedAt: new Date() },
    });

    await deleteStage(escenario.orgId, stage.id);

    const persistida = await prisma.stage.findUnique({ where: { id: stage.id } });
    assert.notEqual(persistida?.deletedAt, null, "la etapa debía poder borrarse");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Escenario 2 — Pipeline -> Stage
// ---------------------------------------------------------------------------

test("deletePipeline rechaza con 400 si el pipeline tiene etapas activas, y el pipeline sigue vivo", async () => {
  const escenario = await montar("pipeline-restrict");
  try {
    // Dos pipelines: con uno solo, el chequeo del último pipeline se dispara
    // antes y taparía el que este test quiere ejercitar.
    const objetivo = await createPipeline(escenario.orgId, { name: "Objetivo" });
    await createPipeline(escenario.orgId, { name: "Otro" });

    await createStage(escenario.orgId, { pipelineId: objetivo.id, name: "S1" });

    let capturado: unknown;
    try {
      await deletePipeline(escenario.orgId, objetivo.id);
      assert.fail("deletePipeline debía rechazar: el pipeline tiene una etapa activa");
    } catch (err) {
      capturado = err;
    }

    assertAppError(
      capturado,
      400,
      "No se puede eliminar un pipeline que tiene etapas activas. Eliminá primero sus etapas.",
    );

    const persistido = await prisma.pipeline.findUnique({ where: { id: objetivo.id } });
    assert.equal(persistido?.deletedAt, null, "el pipeline no debe quedar borrado tras el rechazo");
  } finally {
    await desmontar(escenario);
  }
});

test("deletePipeline procede cuando sus etapas ya están borradas", async () => {
  const escenario = await montar("pipeline-permite");
  try {
    const objetivo = await createPipeline(escenario.orgId, { name: "Objetivo" });
    await createPipeline(escenario.orgId, { name: "Otro" });

    const stage = await createStage(escenario.orgId, { pipelineId: objetivo.id, name: "S1" });
    await deleteStage(escenario.orgId, stage.id);

    await deletePipeline(escenario.orgId, objetivo.id);

    const persistido = await prisma.pipeline.findUnique({ where: { id: objetivo.id } });
    assert.notEqual(persistido?.deletedAt, null, "el pipeline debía poder borrarse");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Las carreras — la mitad del arreglo que los tests secuenciales no ven
//
// M-19 de docs/auditoria-2026-08-29.md: con Promise.allSettled, el lado
// delete siempre commiteaba ANTES de que el lado create llegara a su
// revalidación interna (el preludio de create, fuera de la transacción, es más
// largo), así que create se rechazaba a sí mismo por una revalidación que
// existe con o sin lock — el test pasaba por la razón equivocada y habría
// pasado igual sin ningún lock*ForUpdate. Ahora cada par fuerza los DOS
// interleavings peligrosos con src/lib/carreras.test-helper.ts:
//
//   "create sostiene, delete se bloquea": una transacción A toma el MISMO lock
//   que toma el create real e inserta el hijo sin commitear; el delete real
//   tiene que bloquearse en ese lock (pg_blocking_pids lo confirma) y, al
//   releer, contar el hijo → RESTRICT.
//
//   "delete sostiene, create se bloquea": A toma el MISMO lock que toma el
//   delete real y borra el padre sin commitear; el create real pasa su
//   pre-check (el padre sigue vivo para MVCC), se bloquea en el lock y, al
//   releer, encuentra el padre borrado → rechaza.
//
// En los dos, sin el lock del lado bloqueado B no se bloquea, decide sobre el
// estado viejo y queda el huérfano: el helper lo reporta como fallo
// determinista. La aserción de estado ("cero huérfanos") sigue, pero ahora
// con la certeza de que se llegó a ella por haberse bloqueado.
// ---------------------------------------------------------------------------

async function oportunidadesHuerfanas(orgId: string) {
  return prisma.opportunity.count({
    where: { organizationId: orgId, deletedAt: null, stage: { deletedAt: { not: null } } },
  });
}

async function etapasHuerfanas(orgId: string) {
  return prisma.stage.count({
    where: { organizationId: orgId, deletedAt: null, pipeline: { deletedAt: { not: null } } },
  });
}

async function resultadoDe(promesa: Promise<unknown>): Promise<unknown> {
  return promesa.then(
    () => undefined,
    (err: unknown) => err,
  );
}

test("createOpportunity vs deleteStage — create sostiene el lock del stage: deleteStage se bloquea, relee y aplica el RESTRICT", async () => {
  const escenario = await montar("carrera-stage-a");
  try {
    const pipeline = await createPipeline(escenario.orgId, { name: "P" });
    const stage = await createStage(escenario.orgId, { pipelineId: pipeline.id, name: "S1" });

    // A: el createOpportunity rival — el MISMO lockStageForUpdate que toma el
    // service, y la inserción real, sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockStageForUpdate(stage.id, escenario.orgId, tx);
      await tx.opportunity.create({
        data: {
          organizationId: escenario.orgId,
          ownerId: escenario.userId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          companyId: escenario.companyId,
          title: "Carrera",
        },
      });
    });

    const b = deleteStage(escenario.orgId, stage.id);
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, "deleteStage");

    a.liberar();
    await a.terminada;

    const resultado = await resultadoDe(b);
    assert.ok(resultado instanceof AppError, `deleteStage debía rechazar: ${String(resultado)}`);
    assert.equal(resultado.statusCode, 400);
    assert.match(resultado.message, /oportunidades activas/);

    assert.equal(await oportunidadesHuerfanas(escenario.orgId), 0);
    const vivo = await prisma.stage.findUniqueOrThrow({ where: { id: stage.id } });
    assert.equal(vivo.deletedAt, null, "la etapa con una oportunidad activa no se borra");
  } finally {
    await desmontar(escenario);
  }
});

test("createOpportunity vs deleteStage — delete sostiene el lock: createOpportunity pasa su pre-check, se bloquea, relee y rechaza", async () => {
  const escenario = await montar("carrera-stage-b");
  try {
    const pipeline = await createPipeline(escenario.orgId, { name: "P" });
    const stage = await createStage(escenario.orgId, { pipelineId: pipeline.id, name: "S1" });

    // A: el deleteStage rival — sus dos locks en su orden fijo, y el soft
    // delete real, sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockPipelineForUpdate(pipeline.id, escenario.orgId, tx);
      await lockStageForUpdate(stage.id, escenario.orgId, tx);
      await tx.stage.update({ where: { id: stage.id }, data: { deletedAt: new Date() } });
    });

    const b = createOpportunity(escenario.orgId, escenario.userId, {
      title: "Carrera",
      pipelineId: pipeline.id,
      stageId: stage.id,
      companyId: escenario.companyId,
    });
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, "createOpportunity");

    a.liberar();
    await a.terminada;

    const resultado = await resultadoDe(b);
    assert.ok(
      resultado instanceof AppError,
      `createOpportunity debía rechazar al releer la etapa borrada: ${String(resultado)}`,
    );
    assert.equal(await oportunidadesHuerfanas(escenario.orgId), 0);
  } finally {
    await desmontar(escenario);
  }
});

test("createStage vs deletePipeline — create sostiene el lock del pipeline: deletePipeline se bloquea, relee y aplica el RESTRICT", async () => {
  const escenario = await montar("carrera-pipeline-a");
  try {
    const objetivo = await createPipeline(escenario.orgId, { name: "Objetivo" });
    await createPipeline(escenario.orgId, { name: "Otro" });

    const a = await sostenerTransaccion(async (tx) => {
      await lockPipelineForUpdate(objetivo.id, escenario.orgId, tx);
      await tx.stage.create({
        data: { organizationId: escenario.orgId, pipelineId: objetivo.id, name: "S1", order: 1 },
      });
    });

    const b = deletePipeline(escenario.orgId, objetivo.id);
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, "deletePipeline");

    a.liberar();
    await a.terminada;

    const resultado = await resultadoDe(b);
    assert.ok(resultado instanceof AppError, `deletePipeline debía rechazar: ${String(resultado)}`);
    assert.equal(resultado.statusCode, 400);
    assert.match(resultado.message, /etapas activas/);

    assert.equal(await etapasHuerfanas(escenario.orgId), 0);
    const vivo = await prisma.pipeline.findUniqueOrThrow({ where: { id: objetivo.id } });
    assert.equal(vivo.deletedAt, null, "el pipeline con una etapa activa no se borra");
  } finally {
    await desmontar(escenario);
  }
});

test("createStage vs deletePipeline — delete sostiene los locks: createStage pasa su pre-check, se bloquea, relee y rechaza", async () => {
  const escenario = await montar("carrera-pipeline-b");
  try {
    const objetivo = await createPipeline(escenario.orgId, { name: "Objetivo" });
    await createPipeline(escenario.orgId, { name: "Otro" });

    // A: el deletePipeline rival — organización y DESPUÉS pipeline, su orden
    // fijo, y el soft delete real, sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockOrganizationForUpdate(escenario.orgId, tx);
      await lockPipelineForUpdate(objetivo.id, escenario.orgId, tx);
      await tx.pipeline.update({ where: { id: objetivo.id }, data: { deletedAt: new Date() } });
    });

    const b = createStage(escenario.orgId, { pipelineId: objetivo.id, name: "S1" });
    b.catch(() => undefined);
    await esperarBloqueadoPor(a, b, "createStage");

    a.liberar();
    await a.terminada;

    const resultado = await resultadoDe(b);
    assert.ok(
      resultado instanceof AppError,
      `createStage debía rechazar al releer el pipeline borrado: ${String(resultado)}`,
    );
    assert.equal(
      await etapasHuerfanas(escenario.orgId),
      0,
      "quedó una etapa activa en un pipeline borrado — findManyStages la devolvería en el listado de la organización",
    );
  } finally {
    await desmontar(escenario);
  }
});
