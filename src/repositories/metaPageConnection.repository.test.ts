import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import {
  CAMPOS_PUBLICOS,
  findMetaConnectionByOrganization,
  findPageIdByInstagramBusinessAccountId,
  markMetaConnectionError,
  markMetaConnectionRevoked,
  upsertMetaConnection,
} from "./metaPageConnection.repository";

// Ítem 169. Sin base: se verifica lo que le llega a Prisma con un `db` falso
// que lo captura. Las restricciones de la base (UNIQUE, CHECK, FK) las cubre
// canalesMeta.integration-test.ts.

function dbQueCaptura() {
  const llamadas: { metodo: string; args: Record<string, unknown> }[] = [];
  const registrar =
    (metodo: string, resultado: unknown) => async (args: Record<string, unknown>) => {
      llamadas.push({ metodo, args });
      return resultado;
    };
  const db = {
    metaPageConnection: {
      findUnique: registrar("findUnique", null),
      findFirst: registrar("findFirst", null),
      upsert: registrar("upsert", {}),
      updateMany: registrar("updateMany", { count: 1 }),
    },
  } as unknown as Db;
  return { db, llamadas };
}

test("CAMPOS_PUBLICOS no incluye el token: ninguna lectura para exponer puede filtrarlo", () => {
  assert.equal("pageAccessToken" in CAMPOS_PUBLICOS, false);
  assert.equal(CAMPOS_PUBLICOS.pageId, true);
});

test("findMetaConnectionByOrganization: por organización y con el select público", async () => {
  const { db, llamadas } = dbQueCaptura();
  await findMetaConnectionByOrganization("org-a", db);
  assert.deepEqual(llamadas[0].args, {
    where: { organizationId: "org-a" },
    select: CAMPOS_PUBLICOS,
  });
});

test("upsertMetaConnection: reconectar pisa página, token y connectedAt, limpia el error, y devuelve sin token", async () => {
  const { db, llamadas } = dbQueCaptura();
  await upsertMetaConnection(
    {
      organizationId: "org-a",
      pageId: "111",
      pageAccessToken: "v1.cifrado",
      instagramBusinessAccountId: null,
    },
    db,
  );
  const args = llamadas[0].args as {
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    select: unknown;
  };
  assert.deepEqual(args.where, { organizationId: "org-a" });
  assert.equal(args.select, CAMPOS_PUBLICOS);
  assert.equal(args.create.organizationId, "org-a");
  for (const datos of [args.create, args.update]) {
    assert.equal(datos.pageId, "111");
    assert.equal(datos.pageAccessToken, "v1.cifrado");
    assert.equal(datos.status, "ACTIVE");
    assert.equal(datos.lastErrorAt, null);
    assert.equal(datos.lastErrorMessage, null);
    assert.ok(datos.connectedAt instanceof Date);
  }
  assert.equal(
    "organizationId" in args.update,
    false,
    "el update no mueve la fila de organización",
  );
});

test("markMetaConnectionRevoked: el token va a NULL junto con el REVOKED", async () => {
  const { db, llamadas } = dbQueCaptura();
  await markMetaConnectionRevoked("org-a", db);
  assert.deepEqual(llamadas[0].args, {
    where: { organizationId: "org-a" },
    data: { status: "REVOKED", pageAccessToken: null, lastErrorAt: null, lastErrorMessage: null },
  });
});

test("markMetaConnectionError: conserva el token y trunca el motivo a 500", async () => {
  const { db, llamadas } = dbQueCaptura();
  await markMetaConnectionError("org-a", "x".repeat(800), db);
  const data = llamadas[0].args.data as Record<string, unknown>;
  assert.equal(data.status, "ERROR");
  assert.equal((data.lastErrorMessage as string).length, 500);
  assert.equal("pageAccessToken" in data, false, "el ERROR no toca el token");
});

test("findPageIdByInstagramBusinessAccountId (ítem 171): sin organizationId, sin las REVOKED, solo el pageId y con orden estable", async () => {
  const { db, llamadas } = dbQueCaptura();
  await findPageIdByInstagramBusinessAccountId("1784", db);
  assert.equal(llamadas[0].metodo, "findFirst");
  assert.deepEqual(llamadas[0].args, {
    where: { instagramBusinessAccountId: "1784", status: { not: "REVOKED" } },
    select: { pageId: true },
    orderBy: [{ connectedAt: "desc" }, { id: "asc" }],
  });
});
