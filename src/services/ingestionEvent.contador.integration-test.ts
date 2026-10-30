import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { IngestionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { contarIngestaFallida, DIAS_DEL_CONTADOR } from "./ingestionEvent.service";

// ---------------------------------------------------------------------------
// El contador del menú "Eventos de ingesta" (contarIngestaFallida), contra
// Postgres real: cuenta FAILED y DEAD_LETTER de los últimos 7 días que
// llegaron por una fuente que no es un archivo, y solo de su organización.
// ---------------------------------------------------------------------------

let orgId: string;
let otraOrgId: string;
let landing: string;
let planilla: string;

const DIA = 24 * 60 * 60 * 1000;

function evento(sourceId: string, status: IngestionStatus, haceDias = 0, org = orgId) {
  return prisma.ingestionEvent.create({
    data: {
      organizationId: org,
      sourceId,
      externalId: `contador-${randomUUID()}`,
      rawPayload: {},
      status,
      updatedAt: new Date(Date.now() - haceDias * DIA),
    },
  });
}

async function crearOrg() {
  return (
    await prisma.organization.create({
      data: {
        name: `Contador ${randomUUID()}`,
        slug: `contador-ingesta-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  orgId = await crearOrg();
  otraOrgId = await crearOrg();
  landing = (
    await prisma.source.create({
      data: { organizationId: orgId, name: "Landing", type: "WEBHOOK" },
    })
  ).id;
  planilla = (
    await prisma.source.create({
      data: { organizationId: orgId, name: "Planilla", type: "FILE_IMPORT" },
    })
  ).id;
  const deLaOtra = (
    await prisma.source.create({
      data: { organizationId: otraOrgId, name: "Landing", type: "WEBHOOK" },
    })
  ).id;

  await evento(landing, "FAILED");
  await evento(landing, "DEAD_LETTER", 2);
  await evento(landing, "FAILED", DIAS_DEL_CONTADOR + 1); // viejo: no cuenta
  await evento(landing, "PROCESSED"); // no falló
  await evento(landing, "PENDING"); // todavía no falló
  await evento(planilla, "FAILED"); // de un archivo: lo muestra su informe
  await evento(deLaOtra, "FAILED", 0, otraOrgId); // otra organización
});

after(async () => {
  for (const id of [orgId, otraOrgId].filter(Boolean)) {
    await prisma.ingestionEvent.deleteMany({ where: { organizationId: id } });
    await prisma.source.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
});

test("cuenta FAILED y DEAD_LETTER de los últimos 7 días de fuentes que no son archivo", async () => {
  const { total, desde } = await contarIngestaFallida(orgId);

  assert.equal(total, 2);
  assert.ok(Math.abs(Date.now() - DIAS_DEL_CONTADOR * DIA - desde.getTime()) < 60_000);
});

test("cada organización ve solo lo suyo", async () => {
  assert.equal((await contarIngestaFallida(otraOrgId)).total, 1);
});
