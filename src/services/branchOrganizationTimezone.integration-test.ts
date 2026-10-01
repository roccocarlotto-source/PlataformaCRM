import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createBranch, deleteBranch } from "./branch.service";

// ---------------------------------------------------------------------------
// T-01 (seguimiento de #378): una organización nueva queda en "UTC", el default
// de la columna, porque ni el onboarding ni el alta por platform admin eligen
// zona. Su PRIMERA sucursal activa sí la trae, y si la organización sigue en
// UTC la hereda (heredarZonaDeLaPrimeraSucursal en branch.service.ts). Contra
// Postgres real: la sucursal y la organización se escriben en la misma
// transacción.
//
// Sin usuarios ni Supabase Auth: createBranch sin defaultOwnerId no los
// necesita, así que las organizaciones se crean a mano.
// ---------------------------------------------------------------------------

const creadas: string[] = [];

async function organizacion(timezone?: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `TZ org ${randomUUID()}`,
      slug: `tz-org-${Date.now()}-${randomUUID().slice(0, 8)}`,
      ...(timezone ? { timezone } : {}),
    },
  });
  creadas.push(org.id);
  return org.id;
}

async function zonaDe(organizationId: string): Promise<string> {
  const row = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return row.timezone;
}

after(async () => {
  for (const id of creadas) {
    await prisma.branch.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
});

test("la primera sucursal de una organización en UTC le pasa su zona; la segunda ya no la cambia", async () => {
  const org = await organizacion();
  assert.equal(await zonaDe(org), "UTC", "el default de una organización nueva");

  await createBranch(org, { name: "Casa central", timezone: "America/Santiago" });
  assert.equal(await zonaDe(org), "America/Santiago");

  await createBranch(org, { name: "Sucursal norte", timezone: "America/Asuncion" });
  assert.equal(await zonaDe(org), "America/Santiago", "solo la primera define la zona");
});

test("una organización que ya eligió zona no la pierde con su primera sucursal", async () => {
  const org = await organizacion("America/Montevideo");
  await createBranch(org, { name: "Casa central", timezone: "America/Santiago" });
  assert.equal(await zonaDe(org), "America/Montevideo");
});

test("una primera sucursal en UTC no cambia nada, y la siguiente ya no es la primera", async () => {
  const org = await organizacion();
  await createBranch(org, { name: "Casa central", timezone: "UTC" });
  assert.equal(await zonaDe(org), "UTC");

  await createBranch(org, { name: "Sucursal norte", timezone: "America/Santiago" });
  assert.equal(await zonaDe(org), "UTC", "ya había una sucursal activa");
});

test("una sucursal borrada no cuenta: la siguiente activa es la primera", async () => {
  const org = await organizacion();
  const borrada = await createBranch(org, { name: "Vieja", timezone: "UTC" });
  await deleteBranch(org, borrada.id);

  await createBranch(org, { name: "Casa central", timezone: "America/Montevideo" });
  assert.equal(await zonaDe(org), "America/Montevideo");
});
