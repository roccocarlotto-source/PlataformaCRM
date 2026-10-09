import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthContext } from "../types/auth";
import { crearAuthContextCache } from "./authContextCache";

// ---------------------------------------------------------------------------
// D5 / FABLE-I-03 (docs-privados, local): la caché corta del contexto de
// autenticación.
// ---------------------------------------------------------------------------

const contexto = (userId: string, role: AuthContext["role"] = "USER"): AuthContext => ({
  userId,
  organizationId: "org-1",
  role,
  email: `${userId}@example.test`,
  fullName: "Ana Pérez",
  edition: "COMPLETA",
});

test("dentro del TTL devuelve lo guardado; vencido, nada (y hay que volver a la base)", () => {
  let reloj = 1_000;
  const cache = crearAuthContextCache(5_000, () => reloj);
  assert.equal(cache.leer("u1"), null);

  cache.guardar(contexto("u1"));
  reloj += 4_999;
  assert.deepEqual(cache.leer("u1"), contexto("u1"));

  reloj += 1;
  assert.equal(cache.leer("u1"), null, "a los 5 segundos ya no vale");
});

test("cada usuario tiene su entrada, y olvidar a uno no toca a los demás", () => {
  const cache = crearAuthContextCache(5_000, () => 0);
  cache.guardar(contexto("u1", "ADMIN"));
  cache.guardar(contexto("u2"));

  cache.olvidar("u1");

  assert.equal(cache.leer("u1"), null);
  assert.equal(cache.leer("u2")?.role, "USER");
});

test("guardar de nuevo reemplaza el contexto y renueva el plazo", () => {
  let reloj = 0;
  const cache = crearAuthContextCache(5_000, () => reloj);
  cache.guardar(contexto("u1", "USER"));
  reloj = 4_000;
  cache.guardar(contexto("u1", "ADMIN"));
  reloj = 8_000;
  assert.equal(cache.leer("u1")?.role, "ADMIN");
});

test("con TTL 0 no guarda nada: cada request va a la base, como antes", () => {
  const cache = crearAuthContextCache(0, () => 0);
  cache.guardar(contexto("u1"));
  assert.equal(cache.leer("u1"), null);
});
