import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { lockBranchForUpdate } from "./branch.repository";
import { lockOrganizationForUpdate } from "./organization.repository";
import { lockPipelineForUpdate } from "./pipeline.repository";
import { lockResourceForUpdate } from "./resource.repository";
import { lockServiceTypeForUpdate } from "./serviceType.repository";
import { lockStageForUpdate } from "./stage.repository";

// ---------------------------------------------------------------------------
// B-17 de docs/auditoria-2026-08-29.md — los seis lock*ForUpdate verifican que
// bloquearon una fila.
//
// Antes, un SELECT ... FOR UPDATE que no encontraba nada (id inexistente, u
// organizationId que no coincide) "tenía éxito" para Postgres —cero filas, sin
// error—, no bloqueaba nada, y la función retornaba: el caller seguía como si
// hubiera serializado contra una fila real.
//
// NO ES UNA PRUEBA DE CARRERA (a diferencia de M-19): es una guarda
// determinística sobre un resultado que antes se ignoraba, así que el test
// directo alcanza — cada lock, dentro de una transacción, con la fila real
// pero un organizationId ajeno (o, para el de organización, un id que no
// existe), tiene que tirar. Y el control positivo: con los datos correctos,
// los seis toman su lock y la transacción completa sin error.
// ---------------------------------------------------------------------------

let orgId: string;
let pipelineId: string;
let stageId: string;
let branchId: string;
let resourceId: string;
let serviceTypeId: string;

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `B17 org ${randomUUID()}`,
      slug: `b17-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: `B17 pipeline ${randomUUID()}` },
  });
  pipelineId = pipeline.id;

  const stage = await prisma.stage.create({
    data: { organizationId: orgId, pipelineId, name: "B17 stage", order: 1 },
  });
  stageId = stage.id;

  const branch = await prisma.branch.create({
    data: { organizationId: orgId, name: "B17 branch", timezone: "America/Argentina/Buenos_Aires" },
  });
  branchId = branch.id;

  const resource = await prisma.resource.create({
    data: { organizationId: orgId, branchId, name: "B17 resource", type: "PERSON" },
  });
  resourceId = resource.id;

  const serviceType = await prisma.serviceType.create({
    data: {
      organizationId: orgId,
      branchId,
      resourceId,
      name: "B17 service",
      durationMin: 30,
    },
  });
  serviceTypeId = serviceType.id;
});

after(async () => {
  if (!orgId) return;
  await prisma.serviceType.deleteMany({ where: { organizationId: orgId } });
  await prisma.resource.deleteMany({ where: { organizationId: orgId } });
  await prisma.branch.deleteMany({ where: { organizationId: orgId } });
  await prisma.stage.deleteMany({ where: { organizationId: orgId } });
  await prisma.pipeline.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

test("lockOrganizationForUpdate con una organización inexistente tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockOrganizationForUpdate(randomUUID(), tx)),
    /lockOrganizationForUpdate: .* no se tomó ningún lock/,
  );
});

test("lockPipelineForUpdate con el pipeline real pero otra organización tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockPipelineForUpdate(pipelineId, randomUUID(), tx)),
    /lockPipelineForUpdate: .* no se tomó ningún lock/,
  );
});

test("lockStageForUpdate con el stage real pero otra organización tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockStageForUpdate(stageId, randomUUID(), tx)),
    /lockStageForUpdate: .* no se tomó ningún lock/,
  );
});

test("lockBranchForUpdate con la branch real pero otra organización tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockBranchForUpdate(branchId, randomUUID(), tx)),
    /lockBranchForUpdate: .* no se tomó ningún lock/,
  );
});

test("lockResourceForUpdate con el resource real pero otra organización tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockResourceForUpdate(resourceId, randomUUID(), tx)),
    /lockResourceForUpdate: .* no se tomó ningún lock/,
  );
});

test("lockServiceTypeForUpdate con el serviceType real pero otra organización tira en vez de retornar sin lock", async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => lockServiceTypeForUpdate(serviceTypeId, randomUUID(), tx)),
    /lockServiceTypeForUpdate: .* no se tomó ningún lock/,
  );
});

// El control positivo, en una sola transacción: los seis con los datos
// correctos toman su lock y no tiran — la guarda no volvió inalcanzable el
// camino feliz. Una fila soft-deleted también se bloquea (el SQL no filtra
// deleted_at, a propósito: el lock serializa sobre la fila física).
test("con los datos correctos, los seis locks se toman sin error — la guarda no rompe el camino feliz", async () => {
  await prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(orgId, tx);
    await lockPipelineForUpdate(pipelineId, orgId, tx);
    await lockStageForUpdate(stageId, orgId, tx);
    await lockBranchForUpdate(branchId, orgId, tx);
    await lockResourceForUpdate(resourceId, orgId, tx);
    await lockServiceTypeForUpdate(serviceTypeId, orgId, tx);
  });
});
