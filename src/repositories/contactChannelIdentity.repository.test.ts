import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import {
  createContactChannelIdentity,
  findContactIdByExternalIdentity,
} from "./contactChannelIdentity.repository";

// Ítem 169. Sin base: se verifica lo que le llega a Prisma con un `db` falso.
// Que el UNIQUE y la FK compuesta se sostengan en Postgres lo cubre
// canalesMeta.integration-test.ts.

const IDENTIDAD = {
  organizationId: "org-a",
  channel: "MESSENGER" as const,
  externalId: "psid-123",
};

test("findContactIdByExternalIdentity: busca por el UNIQUE (organización, canal, id externo)", async () => {
  let args: unknown;
  const db = {
    contactChannelIdentity: {
      findUnique: async (a: unknown) => {
        args = a;
        return { contactId: "contacto-1" };
      },
    },
  } as unknown as Db;

  assert.equal(await findContactIdByExternalIdentity(IDENTIDAD, db), "contacto-1");
  assert.deepEqual(args, {
    where: { organizationId_channel_externalId: IDENTIDAD },
    select: { contactId: true },
  });
});

test("findContactIdByExternalIdentity: null si el id externo no se vio nunca", async () => {
  const db = {
    contactChannelIdentity: { findUnique: async () => null },
  } as unknown as Db;
  assert.equal(await findContactIdByExternalIdentity(IDENTIDAD, db), null);
});

test("createContactChannelIdentity: un create a secas — el P2002 del UNIQUE le llega al caller", async () => {
  const llamadas: string[] = [];
  const db = {
    contactChannelIdentity: {
      create: async (a: { data: unknown }) => {
        llamadas.push("create");
        return a.data;
      },
      upsert: async () => {
        llamadas.push("upsert");
      },
    },
  } as unknown as Db;

  await createContactChannelIdentity({ ...IDENTIDAD, contactId: "contacto-1" }, db);
  assert.deepEqual(llamadas, ["create"]);
});
