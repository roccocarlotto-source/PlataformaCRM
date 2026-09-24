import assert from "node:assert/strict";
import { test } from "node:test";
import { esUrlDeBaseLocal } from "./baseLocal";
import { workersHabilitados } from "./workersHabilitados";

const REMOTA =
  "postgresql://postgres.abc:secreto@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test("development + base remota → no arranca, y el motivo nombra el host", () => {
  const d = workersHabilitados({
    nodeEnv: "development",
    databaseUrl: REMOTA,
    permitirBaseRemota: false,
  });
  assert.equal(d.arrancar, false);
  assert.match(d.motivo, /aws-0-sa-east-1\.pooler\.supabase\.com/);
  // El motivo va al log: nunca la URL entera con la contraseña.
  assert.doesNotMatch(d.motivo, /secreto/);
});

test("development + base local → arranca", () => {
  const d = workersHabilitados({
    nodeEnv: "development",
    databaseUrl: LOCAL,
    permitirBaseRemota: false,
  });
  assert.equal(d.arrancar, true);
});

test("development + base remota + DEV_ALLOW_REMOTE_DB → arranca", () => {
  const d = workersHabilitados({
    nodeEnv: "development",
    databaseUrl: REMOTA,
    permitirBaseRemota: true,
  });
  assert.equal(d.arrancar, true);
  assert.match(d.motivo, /DEV_ALLOW_REMOTE_DB/);
});

test("production + base remota → arranca (comportamiento de siempre)", () => {
  const d = workersHabilitados({
    nodeEnv: "production",
    databaseUrl: REMOTA,
    permitirBaseRemota: false,
  });
  assert.equal(d.arrancar, true);
});

test("test → arranca igual que antes, sea cual sea la base", () => {
  for (const databaseUrl of [REMOTA, LOCAL, undefined]) {
    const d = workersHabilitados({ nodeEnv: "test", databaseUrl, permitirBaseRemota: false });
    assert.equal(d.arrancar, true);
  }
});

test("development sin DATABASE_URL o con una imparseable → no arranca", () => {
  for (const databaseUrl of [undefined, "", "no es una url"]) {
    const d = workersHabilitados({
      nodeEnv: "development",
      databaseUrl,
      permitirBaseRemota: false,
    });
    assert.equal(d.arrancar, false);
  }
});

test("esUrlDeBaseLocal: localhost, 127.0.0.1 y ::1 son locales", () => {
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@localhost:5432/db"), true);
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@127.0.0.1:54322/postgres"), true);
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@[::1]:5432/db"), true);
});

test("esUrlDeBaseLocal: compara el hostname, no un substring de la URL", () => {
  assert.equal(esUrlDeBaseLocal("postgresql://u:localhost@db.remota.com:5432/db"), false);
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@db.remota.com:5432/localhost"), false);
  assert.equal(esUrlDeBaseLocal("postgresql://u:p@localhost.remota.com:5432/db"), false);
});
