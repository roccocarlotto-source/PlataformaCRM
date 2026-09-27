import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import {
  countAgentsByBranch,
  findAgentByFacebookPageId,
  findAgentByIdForPlatformAdmin,
  setAgentFacebookPageId,
  softDeleteAgent,
} from "./agent.repository";

// El conteo del RESTRICT de deleteBranch (ítem 167), sin base: se verifica el
// WHERE que le llega a Prisma con un `db` falso que lo captura. Que Postgres
// devuelva esas filas y no otras lo cubre booking-config.integration-test.ts.

test("countAgentsByBranch: sucursal + organización, sin borrados, activos o no", async () => {
  let where: unknown;
  const db = {
    agent: {
      count: async (args: { where: unknown }) => {
        where = args.where;
        return 2;
      },
    },
  } as unknown as Db;

  assert.equal(await countAgentsByBranch("branch-1", "org-a", db), 2);
  // Sin filtro de isActive: un Agent inactivo también bloquea la baja.
  assert.deepEqual(where, { branchId: "branch-1", organizationId: "org-a", deletedAt: null });
});

// Ítem 169: la página de Facebook del agente, calco del número de WhatsApp.
// Mismo `db` falso que captura lo que le llega a Prisma.
function dbQueCaptura() {
  const llamadas: { metodo: string; args: unknown }[] = [];
  const registrar = (metodo: string, resultado: unknown) => async (args: unknown) => {
    llamadas.push({ metodo, args });
    return resultado;
  };
  const db = {
    agent: {
      findFirst: registrar("findFirst", null),
      updateMany: registrar("updateMany", { count: 1 }),
    },
  } as unknown as Db;
  return { db, llamadas };
}

test("findAgentByFacebookPageId: sin organizationId, sin borrados, y solo lo que el webhook necesita", async () => {
  const { db, llamadas } = dbQueCaptura();
  await findAgentByFacebookPageId("1234567890", db);
  assert.deepEqual(llamadas, [
    {
      metodo: "findFirst",
      args: {
        where: { facebookPageId: "1234567890", deletedAt: null },
        select: { id: true, organizationId: true, branchId: true, isActive: true, channels: true },
      },
    },
  ]);
});

test("setAgentFacebookPageId: escribe solo la página, sobre un agente no borrado; null la libera", async () => {
  const { db, llamadas } = dbQueCaptura();
  await setAgentFacebookPageId("agente-1", "1234567890", db);
  await setAgentFacebookPageId("agente-1", null, db);
  assert.deepEqual(
    llamadas.map((l) => l.args),
    [
      { where: { id: "agente-1", deletedAt: null }, data: { facebookPageId: "1234567890" } },
      { where: { id: "agente-1", deletedAt: null }, data: { facebookPageId: null } },
    ],
  );
});

test("findAgentByIdForPlatformAdmin: trae la página actual, para el log de la asignación", async () => {
  const { db, llamadas } = dbQueCaptura();
  await findAgentByIdForPlatformAdmin("agente-1", db);
  const args = llamadas[0].args as { select: Record<string, boolean> };
  assert.equal(args.select.facebookPageId, true);
  assert.equal(args.select.whatsappPhoneNumberId, true);
});

test("softDeleteAgent: libera el número de WhatsApp Y la página de Facebook", async () => {
  const { db, llamadas } = dbQueCaptura();
  await softDeleteAgent("agente-1", "org-a", db);
  const args = llamadas[0].args as { where: unknown; data: Record<string, unknown> };
  assert.deepEqual(args.where, { id: "agente-1", organizationId: "org-a", deletedAt: null });
  assert.equal(args.data.whatsappPhoneNumberId, null);
  assert.equal(args.data.facebookPageId, null);
  assert.ok(args.data.deletedAt instanceof Date);
});
