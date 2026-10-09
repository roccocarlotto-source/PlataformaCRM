import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type OrganizationIndustry } from "@prisma/client";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Rubro de la organización (migración 20261031120000, docs/rubros.md §1.1,
// PR R1). Solo la columna: ningún código la lee todavía.
//
//   - Una organización creada sin rubro es AUTOMOTORA (el DEFAULT es lo que
//     deja a las existentes como estaban, sin backfill).
//   - Los dos valores del enum se guardan y se leen tal cual.
//   - Un valor fuera del enum lo rechaza la base, no solo el cliente de
//     Prisma.
// ---------------------------------------------------------------------------

async function conOrganizacion(
  etiqueta: string,
  industry: OrganizationIndustry | undefined,
  fn: (org: { id: string; industry: OrganizationIndustry }) => Promise<void>,
): Promise<void> {
  const org = await prisma.organization.create({
    data: {
      name: `Rubro ${etiqueta} ${randomUUID()}`,
      slug: `rubro-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      ...(industry ? { industry } : {}),
    },
    select: { id: true, industry: true },
  });
  try {
    await fn(org);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

test("una organización nueva sin rubro explícito es AUTOMOTORA", async () => {
  await conOrganizacion("default", undefined, async (org) => {
    assert.equal(org.industry, "AUTOMOTORA");
  });
});

test("los dos rubros se guardan y se leen tal cual", async () => {
  for (const industry of ["AUTOMOTORA", "CLINICA"] as const) {
    await conOrganizacion(industry.toLowerCase(), industry, async (org) => {
      const leida = await prisma.organization.findUniqueOrThrow({
        where: { id: org.id },
        select: { industry: true },
      });
      assert.equal(leida.industry, industry);
    });
  }
});

test("la base rechaza un rubro fuera del enum", async () => {
  await conOrganizacion("invalido", undefined, async (org) => {
    await assert.rejects(
      prisma.$executeRaw`UPDATE organizations SET industry = 'OTRO'::"OrganizationIndustry" WHERE id = ${org.id}::uuid`,
      /invalid input value for enum/,
    );
    const leida = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { industry: true },
    });
    assert.equal(leida.industry, "AUTOMOTORA");
  });
});
