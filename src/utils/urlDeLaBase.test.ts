import assert from "node:assert/strict";
import { test } from "node:test";
import { problemaDeLaUrlDeLaBase } from "./urlDeLaBase";

const POOLER = "postgresql://usuario:clave-secreta@pooler.example.com:6543/postgres";
const DIRECTA = "postgresql://usuario:clave-secreta@db.example.com:5432/postgres";

test("pooler 6543 con pgbouncer=true y connection_limit: sin problema", () => {
  assert.equal(problemaDeLaUrlDeLaBase(`${POOLER}?pgbouncer=true&connection_limit=10`), null);
  assert.equal(problemaDeLaUrlDeLaBase(`${POOLER}?connection_limit=10&pgbouncer=true`), null);
  assert.equal(problemaDeLaUrlDeLaBase(`${POOLER}?pgbouncer=true`), null);
});

test("pooler 6543 sin pgbouncer=true: avisa (el incidente del 2026-10-12)", () => {
  for (const url of [
    POOLER,
    `${POOLER}?`,
    `${POOLER}?connection_limit=10`,
    `${POOLER}?pgbouncer=false`,
  ]) {
    assert.match(problemaDeLaUrlDeLaBase(url) ?? "", /sin "pgbouncer=true"/, url);
  }
});

test('un "?" de más: avisa que Prisma la rechaza (P1013)', () => {
  assert.match(problemaDeLaUrlDeLaBase(`${POOLER}??connection_limit=10`) ?? "", /P1013/);
});

test("otro puerto (conexión directa, base local): sin problema", () => {
  assert.equal(problemaDeLaUrlDeLaBase(DIRECTA), null);
  assert.equal(
    problemaDeLaUrlDeLaBase("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
    null,
  );
  assert.equal(problemaDeLaUrlDeLaBase(undefined), null);
});

test("el mensaje nunca incluye la URL ni la contraseña", () => {
  for (const url of [POOLER, `${POOLER}??connection_limit=10`, "no-es-una-url clave-secreta"]) {
    const problema = problemaDeLaUrlDeLaBase(url) ?? "";
    assert.ok(problema.length > 0, url);
    assert.ok(!problema.includes("clave-secreta"), problema);
    assert.ok(!problema.includes("pooler.example.com"), problema);
  }
});
