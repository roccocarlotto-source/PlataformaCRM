import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import { countConfirmedBookingsOf } from "./booking.repository";

// Los conteos de los RESTRICT de deleteBranch y deleteContact (ítem 167), sin
// base: se verifica el WHERE que le llega a Prisma con un `db` falso que lo
// captura.

function espia() {
  const wheres: unknown[] = [];
  const db = {
    booking: {
      count: async (args: { where: unknown }) => {
        wheres.push(args.where);
        return 1;
      },
    },
  } as unknown as Db;
  return { db, wheres };
}

test("countConfirmedBookingsOf por sucursal: solo CONFIRMED, con organizationId", async () => {
  const { db, wheres } = espia();
  assert.equal(await countConfirmedBookingsOf({ branchId: "branch-1" }, "org-a", db), 1);
  assert.deepEqual(wheres, [
    { branchId: "branch-1", organizationId: "org-a", status: "CONFIRMED" },
  ]);
});

test("countConfirmedBookingsOf por contacto: solo CONFIRMED, con organizationId", async () => {
  const { db, wheres } = espia();
  assert.equal(await countConfirmedBookingsOf({ contactId: "contact-1" }, "org-a", db), 1);
  assert.deepEqual(wheres, [
    { contactId: "contact-1", organizationId: "org-a", status: "CONFIRMED" },
  ]);
});
