import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertBaseLocalEnTest,
  esUrlDeBaseLocal,
  correBajoTests,
  forzarConexionesDeTest,
} from "./baseLocal";

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
    /DATABASE_URL apuntando a un servidor que NO es local \(aws-0-sa-east-1\.pooler\.supabase\.com\)/,
  );
  assert.throws(
    () => assertBaseLocalEnTest({ NODE_ENV: "test", DATABASE_URL: LOCAL, DIRECT_URL: REMOTA }),
    /DIRECT_URL apuntando a un servidor que NO es local/,
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

test("assertBaseLocalEnTest: fuera de los tests no interviene", () => {
  for (const NODE_ENV of ["development", "production", undefined]) {
    assert.doesNotThrow(() => assertBaseLocalEnTest({ NODE_ENV, DATABASE_URL: REMOTA }, false));
  }
});

// ---------------------------------------------------------------------------
// FABLE-H-01 (docs-privados/auditoria-2026-10-05-FABLE.md, local): el freno
// actúa siempre que se corran tests, no solo con NODE_ENV=test.
// ---------------------------------------------------------------------------

test("correBajoTests: por NODE_ENV, por el test runner de Node o por el archivo que se ejecuta", () => {
  const proceso = (env: Record<string, string | undefined>, ...argv: string[]) => ({
    env,
    argv: ["node", ...argv],
  });
  assert.equal(correBajoTests(proceso({ NODE_ENV: "test" }, "dist/server.js")), true);
  // `tsx --test archivo`: el runner lanza cada archivo con NODE_TEST_CONTEXT.
  assert.equal(correBajoTests(proceso({ NODE_TEST_CONTEXT: "child-v8" }, "x.js")), true);
  // Un archivo de test corrido directo, sin --test ni NODE_ENV.
  for (const archivo of [
    "src/workers/x.integration-test.ts",
    "C:\\repo\\src\\utils\\baseLocal.test.ts",
    "dist/algo.test.js",
  ]) {
    assert.equal(correBajoTests(proceso({}, archivo)), true, archivo);
  }
  // El servidor, un script o el seed NO son tests.
  for (const archivo of ["dist/server.js", "src/server.ts", "scripts/seed-dev-data.ts"]) {
    assert.equal(correBajoTests(proceso({ NODE_ENV: "development" }, archivo)), false, archivo);
    assert.equal(correBajoTests(proceso({ NODE_ENV: "production" }, archivo)), false, archivo);
  }
});

test("FABLE-H-01: corriendo tests SIN NODE_ENV=test, una base o un Supabase remotos también abortan", () => {
  for (const NODE_ENV of ["development", undefined]) {
    assert.throws(
      () => assertBaseLocalEnTest({ NODE_ENV, DATABASE_URL: REMOTA }, true),
      /DATABASE_URL apuntando a un servidor que NO es local/,
    );
  }
  assert.throws(
    () =>
      assertBaseLocalEnTest(
        { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL, SUPABASE_URL: "https://abc.supabase.co" },
        true,
      ),
    /SUPABASE_URL apuntando a un servidor que NO es local \(abc\.supabase\.co\)/,
  );
  assert.doesNotThrow(() =>
    assertBaseLocalEnTest(
      { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL, SUPABASE_URL: "http://127.0.0.1:54321" },
      true,
    ),
  );
});

test("FABLE-H-01: este mismo proceso —un test corrido sin NODE_ENV=test— queda cubierto por el freno", () => {
  assert.equal(correBajoTests(), true);
  assert.throws(() => assertBaseLocalEnTest({ DATABASE_URL: REMOTA }), /NO es local/);
});

test("forzarConexionesDeTest: las conexiones de .env.test pisan lo que haya; el resto del entorno no se toca", () => {
  const entorno: Record<string, string | undefined> = {
    DATABASE_URL: REMOTA,
    DIRECT_URL: REMOTA,
    SUPABASE_URL: "https://abc.supabase.co",
    OTRA_COSA: "se queda",
    NODE_ENV: "development",
  };
  forzarConexionesDeTest(entorno, {
    DATABASE_URL: LOCAL,
    DIRECT_URL: LOCAL,
    SUPABASE_URL: "http://127.0.0.1:54321",
    NODE_ENV: "test",
    OTRA_COSA: "no se copia",
  });
  assert.equal(entorno.DATABASE_URL, LOCAL);
  assert.equal(entorno.DIRECT_URL, LOCAL);
  assert.equal(entorno.SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(entorno.OTRA_COSA, "se queda");
  assert.equal(entorno.NODE_ENV, "development");
  assert.doesNotThrow(() => assertBaseLocalEnTest(entorno, true));

  // Sin .env.test no hace nada: decide el freno con lo que haya.
  const sinArchivo: Record<string, string | undefined> = { DATABASE_URL: REMOTA };
  forzarConexionesDeTest(sinArchivo, null);
  assert.equal(sinArchivo.DATABASE_URL, REMOTA);
  assert.throws(() => assertBaseLocalEnTest(sinArchivo, true), /NO es local/);
});
