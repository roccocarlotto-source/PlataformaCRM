import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import { countKnowledgeBaseEntriesByBranch } from "./knowledgeBaseEntry.repository";

// El conteo del RESTRICT de deleteBranch (ítem 167), sin base: se verifica el
// WHERE que le llega a Prisma con un `db` falso que lo captura.

test("countKnowledgeBaseEntriesByBranch: sucursal + organización, sin borradas, manuales o del stock", async () => {
  let where: unknown;
  const db = {
    knowledgeBaseEntry: {
      count: async (args: { where: unknown }) => {
        where = args.where;
        return 4;
      },
    },
  } as unknown as Db;

  assert.equal(await countKnowledgeBaseEntriesByBranch("branch-1", "org-a", db), 4);
  // Sin filtro de sourceVehicleId ni de isActive: todas bloquean.
  assert.deepEqual(where, { branchId: "branch-1", organizationId: "org-a", deletedAt: null });
});
