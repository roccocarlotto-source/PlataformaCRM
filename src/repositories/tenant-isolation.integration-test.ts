import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "./role.repository";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";

import { updateCompany, softDeleteCompany } from "./company.repository";
import { updateContact, softDeleteContact } from "./contact.repository";
import { updatePipeline, softDeletePipeline } from "./pipeline.repository";
import {
  updateStage,
  softDeleteStage,
  reindexStages,
} from "./stage.repository";
import {
  updateOpportunity,
  softDeleteOpportunity,
} from "./opportunity.repository";
import { updateActivity, softDeleteActivity } from "./activity.repository";
import { updateUser, softDeleteUser } from "./user.repository";
import { revokeInvitationConditional } from "./invitation.repository";
import { updateSource, softDeleteSource } from "./source.repository";
import {
  revokeApiKeyConditional,
  revokeApiKeysBySource,
} from "./apiKey.repository";

// Test de integración: prueba el contrato de aislamiento multi-tenant de las
// 16 escrituras tenant-scoped incluidas en M4, directamente contra Postgres
// real (Supabase, ver README) — sin mocks de Prisma. No pasa por la capa de
// service ni por Express: la garantía bajo prueba vive en el repository
// (WHERE efectivo de la escritura), no en el pre-check del service.
//
// Propiedad probada por cada una de las 15 escrituras id + organizationId:
// existe un registro de Organization B; se la invoca con el id de ese
// registro pero el organizationId de Organization A; la escritura no debe
// afectar ninguna fila (count === 0) y el registro de B debe permanecer
// exactamente igual tras una relectura independiente.
//
// reindexStages es la 16.ª y tiene una frontera distinta (pipelineId, no
// organizationId — ver stage.repository.ts): el test intenta reindexar un
// Stage ajeno (de otro pipeline, de otra organización) junto con Stages
// legítimos de Pipeline B, y prueba que ni el Stage ajeno ni los legítimos
// cambian — la función debe abortar la transacción completa antes de tocar
// nada, no solo "saltear" el id ajeno.
//
// SEGUNDA PROPIEDAD, agregada con la capa de ingesta: que la BASE rechace una
// referencia cross-tenant. Antes de C-3 (migración 20260821140200) no tenía
// sentido escribir estos tests, porque la base no las rechazaba: las FKs eran
// de columna simple y Postgres solo verificaba que el UUID referenciado
// existiera, no que perteneciera a la misma organización. El caso no es
// hipotético — la primera corrida de la suite completa en CI encontró un
// fixture que llevaba semanas creando una referencia cross-tenant real
// (invitation.service.integration-test.ts:291).
//
// La diferencia con las 16 de arriba importa: allá la garantía es el WHERE de
// la escritura, la prueba la ejecuta el repository y el éxito es count === 0.
// Acá la garantía es la constraint, la escritura va directo por Prisma sin
// pasar por ninguna capa nuestra, y el éxito es una EXCEPCIÓN. Es
// deliberadamente un test del contrato de la base, no de nuestro código: la
// promoción masiva staging -> Contact (ítem 4 del documento de ingesta) no
// pasa por los services, así que las FKs compuestas van a ser su única
// defensa.
//
// LOS TESTS DE ESCRITURA DIFERIDOS DEL ÍTEM 2, saldados en el ítem 3. Aquella
// vez no se escribieron porque los modelos nuevos no tenían repository, y un
// `prisma.source.updateMany({ where: { id, organizationId } })` no habría
// probado nada nuestro, solo que Prisma traduce un WHERE a SQL. Ahora Source y
// ApiKey sí tienen repository, así que sus 4 escrituras entran con el mismo
// patrón que las 16 originales.
//
// IngestionEvent SIGUE SIN ELLOS, y esta vez la razón es distinta: nada en el
// ítem 3 escribe eventos de ingesta, así que darle un repository ahora sería
// crear código muerto para poder testearlo. Sus escrituras nacen con el ítem 4
// —el worker y la promoción— y sus tests van con ellas.
//
// Un solo fixture (Organization A + Organization B con un registro real por
// entidad) se crea una vez en `before` y se reusa en las 28 pruebas: ninguna
// debería lograr mutar el estado de B si el aislamiento funciona, así que
// compartir el fixture es seguro y evita crear una identidad real de
// Supabase Auth por caso.

interface Fixture {
  orgA: { id: string };
  orgB: { id: string };
  userB: { id: string };
  companyB: { id: string };
  contactB: { id: string };
  pipelineB: { id: string };
  stageB1: { id: string };
  stageB2: { id: string };
  opportunityB: { id: string };
  activityB: { id: string };
  invitationB: { id: string };
  sourceB: { id: string };
  apiKeyB: { id: string };
  pipelineA: { id: string };
  stageA1: { id: string };
  contactA: { id: string };
  sourceA: { id: string };
  authUserId: string;
}

async function createRealAuthUser(label: string) {
  const email = `m4-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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

let fx: Fixture;

before(async () => {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const orgA = await prisma.organization.create({
    data: { name: `M4 org-a ${randomUUID()}`, slug: `m4-org-a-${Date.now()}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: `M4 org-b ${randomUUID()}`, slug: `m4-org-b-${Date.now()}` },
  });

  const authUserB = await createRealAuthUser("org-b-owner");
  const userB = await prisma.user.create({
    data: {
      id: authUserB.id,
      organizationId: orgB.id,
      roleId: adminRole.id,
      email: authUserB.email,
      fullName: "M4 Org B Owner",
    },
  });

  const companyB = await prisma.company.create({
    data: { organizationId: orgB.id, ownerId: userB.id, name: "M4 Org B Company" },
  });

  const contactB = await prisma.contact.create({
    data: {
      organizationId: orgB.id,
      ownerId: userB.id,
      companyId: companyB.id,
      firstName: "M4",
      lastName: "Org B Contact",
    },
  });

  const pipelineB = await prisma.pipeline.create({
    data: { organizationId: orgB.id, name: `M4 Org B Pipeline ${randomUUID()}` },
  });

  const stageB1 = await prisma.stage.create({
    data: { organizationId: orgB.id, pipelineId: pipelineB.id, name: "B Stage 1", order: 1 },
  });
  const stageB2 = await prisma.stage.create({
    data: { organizationId: orgB.id, pipelineId: pipelineB.id, name: "B Stage 2", order: 2 },
  });

  const opportunityB = await prisma.opportunity.create({
    data: {
      organizationId: orgB.id,
      ownerId: userB.id,
      pipelineId: pipelineB.id,
      stageId: stageB1.id,
      companyId: companyB.id,
      title: "M4 Org B Opportunity",
    },
  });

  const activityB = await prisma.activity.create({
    data: {
      organizationId: orgB.id,
      authorId: userB.id,
      companyId: companyB.id,
      type: "NOTE",
      subject: "M4 Org B Activity",
    },
  });

  const invitationB = await prisma.invitation.create({
    data: {
      organizationId: orgB.id,
      email: `m4-invitee-${randomUUID()}@example.test`,
      roleId: adminRole.id,
      invitedById: userB.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const sourceB = await prisma.source.create({
    data: {
      organizationId: orgB.id,
      name: "M4 Org B Source",
      type: "WEBHOOK",
    },
  });

  const apiKeyB = await prisma.apiKey.create({
    data: {
      organizationId: orgB.id,
      sourceId: sourceB.id,
      keyHash: `m4-org-b-hash-${randomUUID()}`,
      keyPrefix: "crm_orgb01",
    },
  });

  // Pipeline/Stage de Organization A — usados solo por el test de
  // reindexStages, como el Stage "ajeno" que Pipeline B nunca debería poder
  // reindexar.
  const pipelineA = await prisma.pipeline.create({
    data: { organizationId: orgA.id, name: `M4 Org A Pipeline ${randomUUID()}` },
  });
  const stageA1 = await prisma.stage.create({
    data: { organizationId: orgA.id, pipelineId: pipelineA.id, name: "A Stage 1", order: 1 },
  });

  // Contact y Source de Organization A — los referentes LEGÍTIMOS de los
  // casos positivos de las pruebas de FK. Sin ellos, una escritura rechazada
  // no distinguiría "la constraint funcionó" de "la fila estaba mal armada
  // por otra razón".
  const contactA = await prisma.contact.create({
    data: {
      organizationId: orgA.id,
      firstName: "M4",
      lastName: "Org A Contact",
    },
  });

  const sourceA = await prisma.source.create({
    data: {
      organizationId: orgA.id,
      name: "M4 Org A Source",
      type: "WEBHOOK",
    },
  });

  fx = {
    orgA: { id: orgA.id },
    orgB: { id: orgB.id },
    userB: { id: userB.id },
    companyB: { id: companyB.id },
    contactB: { id: contactB.id },
    pipelineB: { id: pipelineB.id },
    stageB1: { id: stageB1.id },
    stageB2: { id: stageB2.id },
    opportunityB: { id: opportunityB.id },
    activityB: { id: activityB.id },
    invitationB: { id: invitationB.id },
    sourceB: { id: sourceB.id },
    apiKeyB: { id: apiKeyB.id },
    pipelineA: { id: pipelineA.id },
    stageA1: { id: stageA1.id },
    contactA: { id: contactA.id },
    sourceA: { id: sourceA.id },
    authUserId: authUserB.id,
  };
});

after(async () => {
  if (!fx) return;
  const ambas = { in: [fx.orgA.id, fx.orgB.id] };

  // ingestion_events y api_keys primero: sus FKs a sources son RESTRICT, así
  // que Postgres rechaza borrar una Source que todavía tenga hijas.
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: ambas } });
  await prisma.apiKey.deleteMany({ where: { organizationId: ambas } });
  await prisma.source.deleteMany({ where: { organizationId: ambas } });
  await prisma.invitation.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.activity.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.opportunity.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.contact.deleteMany({ where: { organizationId: ambas } });
  await prisma.company.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.stage.deleteMany({
    where: { organizationId: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await prisma.pipeline.deleteMany({
    where: { organizationId: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await prisma.user.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.organization.deleteMany({
    where: { id: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.authUserId);
});

// Helper compartido por las 15 pruebas id + organizationId: lee el estado
// de B, ejecuta la escritura cross-tenant, y prueba que no tuvo efecto.
async function assertCrossTenantWriteNoOp<T>(
  read: () => Promise<T>,
  write: () => Promise<{ count: number }>,
  label: string,
) {
  const before = await read();
  const result = await write();
  assert.equal(result.count, 0, `${label}: no debe afectar ninguna fila`);
  const after = await read();
  assert.deepEqual(after, before, `${label}: el registro de Organization B debe permanecer intacto`);
}

test("updateCompany: id de Organization B + organizationId de Organization A no modifica la Company", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.company.findUniqueOrThrow({ where: { id: fx.companyB.id } }),
    () => updateCompany(fx.companyB.id, fx.orgA.id, { name: "hijacked-by-org-a" }),
    "updateCompany",
  );
});

test("softDeleteCompany: id de Organization B + organizationId de Organization A no borra la Company", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.company.findUniqueOrThrow({ where: { id: fx.companyB.id } }),
    () => softDeleteCompany(fx.companyB.id, fx.orgA.id),
    "softDeleteCompany",
  );
});

test("updateContact: id de Organization B + organizationId de Organization A no modifica el Contact", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.contact.findUniqueOrThrow({ where: { id: fx.contactB.id } }),
    () => updateContact(fx.contactB.id, fx.orgA.id, { firstName: "hijacked" }),
    "updateContact",
  );
});

test("softDeleteContact: id de Organization B + organizationId de Organization A no borra el Contact", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.contact.findUniqueOrThrow({ where: { id: fx.contactB.id } }),
    () => softDeleteContact(fx.contactB.id, fx.orgA.id),
    "softDeleteContact",
  );
});

test("updatePipeline: id de Organization B + organizationId de Organization A no modifica el Pipeline", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.pipeline.findUniqueOrThrow({ where: { id: fx.pipelineB.id } }),
    () => updatePipeline(fx.pipelineB.id, fx.orgA.id, { name: "hijacked-pipeline" }),
    "updatePipeline",
  );
});

test("softDeletePipeline: id de Organization B + organizationId de Organization A no borra el Pipeline", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.pipeline.findUniqueOrThrow({ where: { id: fx.pipelineB.id } }),
    () => softDeletePipeline(fx.pipelineB.id, fx.orgA.id),
    "softDeletePipeline",
  );
});

test("updateStage: id de Organization B + organizationId de Organization A no modifica el Stage", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } }),
    () => updateStage(fx.stageB1.id, fx.orgA.id, { name: "hijacked-stage" }),
    "updateStage",
  );
});

test("softDeleteStage: id de Organization B + organizationId de Organization A no borra el Stage", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } }),
    () => softDeleteStage(fx.stageB1.id, fx.orgA.id),
    "softDeleteStage",
  );
});

test("updateOpportunity: id de Organization B + organizationId de Organization A no modifica la Opportunity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.opportunity.findUniqueOrThrow({ where: { id: fx.opportunityB.id } }),
    () => updateOpportunity(fx.opportunityB.id, fx.orgA.id, { title: "hijacked-opportunity" }),
    "updateOpportunity",
  );
});

test("softDeleteOpportunity: id de Organization B + organizationId de Organization A no borra la Opportunity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.opportunity.findUniqueOrThrow({ where: { id: fx.opportunityB.id } }),
    () => softDeleteOpportunity(fx.opportunityB.id, fx.orgA.id),
    "softDeleteOpportunity",
  );
});

test("updateActivity: id de Organization B + organizationId de Organization A no modifica la Activity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.activity.findUniqueOrThrow({ where: { id: fx.activityB.id } }),
    () => updateActivity(fx.activityB.id, fx.orgA.id, { subject: "hijacked-activity" }),
    "updateActivity",
  );
});

test("softDeleteActivity: id de Organization B + organizationId de Organization A no borra la Activity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.activity.findUniqueOrThrow({ where: { id: fx.activityB.id } }),
    () => softDeleteActivity(fx.activityB.id, fx.orgA.id),
    "softDeleteActivity",
  );
});

test("updateUser: id de Organization B + organizationId de Organization A no modifica el User", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.user.findUniqueOrThrow({ where: { id: fx.userB.id } }),
    () => updateUser(fx.userB.id, fx.orgA.id, { isActive: false }),
    "updateUser",
  );
});

test("softDeleteUser: id de Organization B + organizationId de Organization A no borra el User", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.user.findUniqueOrThrow({ where: { id: fx.userB.id } }),
    () => softDeleteUser(fx.userB.id, fx.orgA.id),
    "softDeleteUser",
  );
});

test("revokeInvitationConditional: id de Organization B + organizationId de Organization A no revoca la Invitation", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.invitation.findUniqueOrThrow({ where: { id: fx.invitationB.id } }),
    () => revokeInvitationConditional(fx.invitationB.id, fx.orgA.id),
    "revokeInvitationConditional",
  );
});

test("reindexStages: no reindexa un Stage ajeno al pipeline (de otra organización) aunque el caller se lo pase por id, y aborta el reordenado completo", async () => {
  const stageABefore = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageA1.id } });
  const stageB1Before = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } });
  const stageB2Before = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB2.id } });

  // El caller (por bug, condición de carrera, o intento deliberado) arma un
  // array de reordenado para Pipeline B que incluye un Stage de Pipeline A
  // (Organization A). reindexStages debe rechazarlo — su propia escritura,
  // no el caller, es la garantía.
  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        reindexStages(
          fx.pipelineB.id,
          [fx.stageB1.id, fx.stageA1.id, fx.stageB2.id],
          tx,
        ),
      ),
    /no pertenece al pipeline/,
  );

  const stageAAfter = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageA1.id } });
  const stageB1After = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } });
  const stageB2After = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB2.id } });

  assert.deepEqual(
    stageAAfter,
    stageABefore,
    "el Stage ajeno (otra organización, otro pipeline) no debe tocarse",
  );
  assert.deepEqual(
    stageB1After,
    stageB1Before,
    "la transacción debe abortar completa: ni los Stages legítimos de Pipeline B cambian",
  );
  assert.deepEqual(
    stageB2After,
    stageB2Before,
    "la transacción debe abortar completa: ni los Stages legítimos de Pipeline B cambian",
  );
});

// ---------------------------------------------------------------------------
// Las escrituras de la capa de ingesta (ítem 3), mismo patrón que las 16 de
// arriba: la garantía bajo prueba es el WHERE efectivo del repository.
// ---------------------------------------------------------------------------

test("updateSource: id de Organization B + organizationId de Organization A no modifica la Source", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.source.findUniqueOrThrow({ where: { id: fx.sourceB.id } }),
    () => updateSource(fx.sourceB.id, fx.orgA.id, { name: "hijacked-source" }),
    "updateSource",
  );
});

test("softDeleteSource: id de Organization B + organizationId de Organization A no borra la Source", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.source.findUniqueOrThrow({ where: { id: fx.sourceB.id } }),
    () => softDeleteSource(fx.sourceB.id, fx.orgA.id),
    "softDeleteSource",
  );
});

test("revokeApiKeyConditional: id de Organization B + organizationId de Organization A no revoca la ApiKey", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.apiKey.findUniqueOrThrow({ where: { id: fx.apiKeyB.id } }),
    () => revokeApiKeyConditional(fx.apiKeyB.id, fx.orgA.id),
    "revokeApiKeyConditional",
  );
});

// La escritura MASIVA, que es la que más caro sale si el aislamiento falla:
// una sola llamada podría matar todas las credenciales de una fuente ajena.
// Recibe el sourceId de B con el organizationId de A y no debe tocar nada.
test("revokeApiKeysBySource: sourceId de Organization B + organizationId de Organization A no revoca ninguna ApiKey", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.apiKey.findUniqueOrThrow({ where: { id: fx.apiKeyB.id } }),
    () => revokeApiKeysBySource(fx.sourceB.id, fx.orgA.id),
    "revokeApiKeysBySource",
  );
});

// ---------------------------------------------------------------------------
// Rechazo de referencias cross-tenant por la base — las FKs compuestas de C-3
// aplicadas a la capa de ingesta.
// ---------------------------------------------------------------------------

// La escritura debe fallar con P2003 (violación de FK). Si fallara con
// cualquier otro código —P2002, un NOT NULL, un enum inválido— el test estaría
// pasando por la razón equivocada, así que el predicado es exacto.
async function assertViolaFk(write: () => Promise<unknown>, label: string) {
  await assert.rejects(
    write,
    (err: unknown) =>
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
    `${label}: la base debe rechazar la referencia cross-tenant con una violación de FK`,
  );
}

test("ApiKey de Organization A apuntando a una Source de Organization B: la base la rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.apiKey.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceB.id,
          keyHash: `cross-tenant-${randomUUID()}`,
          keyPrefix: "crm_xxxx",
        },
      }),
    "api_keys -> sources",
  );
});

test("ApiKey de Organization A apuntando a una Source de Organization A: entra bien", async () => {
  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      keyHash: `legitima-${randomUUID()}`,
      keyPrefix: "crm_ok01",
    },
  });

  assert.equal(apiKey.organizationId, fx.orgA.id);
  assert.equal(apiKey.sourceId, fx.sourceA.id);
});

test("IngestionEvent de Organization A apuntando a una Source de Organization B: la base lo rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceB.id,
          rawPayload: { email: "cross-tenant@example.test" },
        },
      }),
    "ingestion_events -> sources",
  );
});

test("IngestionEvent de Organization A con promotedContactId de Organization B: la base lo rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceA.id,
          rawPayload: { email: "promocion-cruzada@example.test" },
          status: "PROCESSED",
          promotedContactId: fx.contactB.id,
        },
      }),
    "ingestion_events -> contacts",
  );
});

test("IngestionEvent de Organization A con promotedContactId de Organization A: entra bien", async () => {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { email: "promocion-legitima@example.test" },
      status: "PROCESSED",
      promotedContactId: fx.contactA.id,
    },
  });

  assert.equal(evento.promotedContactId, fx.contactA.id);
});

// MATCH SIMPLE, no MATCH FULL: con organization_id NOT NULL y
// promoted_contact_id nullable, la FK no se valida mientras la columna
// nullable sea NULL. Es el estado de todo evento todavía no promovido — el
// caso normal, no el borde — así que conviene que esté probado y no supuesto.
test("IngestionEvent sin promotedContactId: la FK compuesta no se evalúa y el evento entra", async () => {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { email: "sin-promover@example.test" },
    },
  });

  assert.equal(evento.promotedContactId, null);
  assert.equal(evento.status, "PENDING");
});

// ---------------------------------------------------------------------------
// Idempotencia — el único parcial (source_id, external_id) WHERE external_id
// IS NOT NULL. No es aislamiento multi-tenant, pero es la otra garantía que
// esta etapa delega en la base en vez de en el código, y se prueba igual: por
// el contrato, no por la implementación.
// ---------------------------------------------------------------------------

test("dos IngestionEvent con el mismo (sourceId, externalId): la base rechaza el segundo", async () => {
  const externalId = `evt-${randomUUID()}`;

  await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      externalId,
      rawPayload: { intento: 1 },
    },
  });

  await assert.rejects(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceA.id,
          externalId,
          rawPayload: { intento: 2 },
        },
      }),
    (err: unknown) =>
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
    "el reintento con el mismo externalId debe violar el único parcial",
  );
});

test("dos IngestionEvent con externalId nulo sobre la misma Source: entran los dos", async () => {
  const primero = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { fila: 1 },
    },
  });
  const segundo = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { fila: 2 },
    },
  });

  // El índice es PARCIAL a propósito: los contactos sin identificador externo
  // no se deduplican entre sí (sección 4 del documento de ingesta), se
  // promueven como nuevos y se marcan para revisión manual. Un único sin el
  // WHERE dejaría pasar exactamente una fila sin externalId por Source.
  assert.notEqual(primero.id, segundo.id);
});
