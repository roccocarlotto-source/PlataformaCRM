import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
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
// ---------------------------------------------------------------------------

test("createOpportunity vs deleteStage: nunca queda una oportunidad activa en una etapa borrada", async () => {
  const escenario = await montar("carrera-stage");
  try {
    const pipeline = await createPipeline(escenario.orgId, { name: "P" });
    const stage = await createStage(escenario.orgId, { pipelineId: pipeline.id, name: "S1" });

    await Promise.allSettled([
      createOpportunity(escenario.orgId, escenario.userId, {
        title: "Carrera",
        pipelineId: pipeline.id,
        stageId: stage.id,
        companyId: escenario.companyId,
      }),
      deleteStage(escenario.orgId, stage.id),
    ]);

    // La aserción es sobre el ESTADO, no sobre quién ganó: los dos
    // interleavings posibles son legítimos, y ninguno puede dejar un huérfano.
    const huerfanas = await prisma.opportunity.count({
      where: {
        organizationId: escenario.orgId,
        deletedAt: null,
        stage: { deletedAt: { not: null } },
      },
    });
    assert.equal(huerfanas, 0, "quedó una oportunidad activa en una etapa borrada");
  } finally {
    await desmontar(escenario);
  }
});

test("createStage vs deletePipeline: nunca queda una etapa activa en un pipeline borrado — el escenario 2 deja de ser alcanzable", async () => {
  const escenario = await montar("carrera-pipeline");
  try {
    const objetivo = await createPipeline(escenario.orgId, { name: "Objetivo" });
    await createPipeline(escenario.orgId, { name: "Otro" });

    await Promise.allSettled([
      createStage(escenario.orgId, { pipelineId: objetivo.id, name: "S1" }),
      deletePipeline(escenario.orgId, objetivo.id),
    ]);

    const huerfanos = await prisma.stage.count({
      where: {
        organizationId: escenario.orgId,
        deletedAt: null,
        pipeline: { deletedAt: { not: null } },
      },
    });
    assert.equal(
      huerfanos,
      0,
      "quedó una etapa activa en un pipeline borrado — findManyStages la devolvería en el listado de la organización",
    );
  } finally {
    await desmontar(escenario);
  }
});
