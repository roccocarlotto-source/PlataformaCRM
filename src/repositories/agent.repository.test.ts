import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import { countAgentsByBranch } from "./agent.repository";

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
