import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBaseLocalEnTest, esUrlDeBaseLocal } from "./baseLocal";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTA =
  "postgresql://postgres.abc:secreto@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

test("esUrlDeBaseLocal: por hostname parseado, no por substring", () => {
  assert.equal(esUrlDeBaseLocal(LOCAL), true);
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@localhost:5432/db"), true);
  assert.equal(esUrlDeBaseLocal(REMOTA), false);
  // "localhost" en la contraseña o en el nombre de la base no la vuelve local.
  assert.equal(esUrlDeBaseLocal("postgresql://u:localhost@db.remoto.com:5432/localhost"), false);
  assert.equal(esUrlDeBaseLocal("no es una url"), false);
  assert.equal(esUrlDeBaseLocal(undefined), false);
});

test("assertBaseLocalEnTest: con NODE_ENV=test y las dos URLs locales, pasa", () => {
  assert.doesNotThrow(() =>
    assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }),
  );
});

test("assertBaseLocalEnTest: con NODE_ENV=test, una URL remota en cualquiera de las dos aborta", () => {
  assert.throws(
    () => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: REMOTA, DIRECT_URL: LOCAL }),
    /DATABASE_URL apuntando a una base que NO es local \(aws-0-sa-east-1\.pooler\.supabase\.com\)/,
  );
  assert.throws(
    () => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: LOCAL, DIRECT_URL: REMOTA }),
    /DIRECT_URL apuntando a una base que NO es local/,
  );
  // Imparseable tampoco se puede comprobar: frena.
  assert.throws(
    () => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: "basura" }),
    /URL imparseable/,
  );
});

test("assertBaseLocalEnTest: el mensaje no filtra la contraseña de la URL", () => {
  assert.throws(
    () => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: REMOTA }),
    (err: Error) => !err.message.includes("secreto"),
  );
});

test("assertBaseLocalEnTest: sin URLs no frena (sin URL no hay a qué conectarse)", () => {
  assert.doesNotThrow(() => assertBaseLocalEnTest({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: "" }));
});

test("assertBaseLocalEnTest: fuera de NODE_ENV=test no interviene", () => {
  for (const NODE_ENV of ["development", "production", undefined]) {
    assert.doesNotThrow(() => assertBaseLocalEnTest({ NODE_ENV, DATABASE_URL: REMOTA }));
  }
});
