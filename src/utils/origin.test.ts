import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOrigin } from "./origin";

// normalizeOrigin es lo que decide qué entra a Agent.allowedOrigins y, en el
// 5b, contra qué se compara el header Origin. Los dos lados pasan por acá,
// así que lo que importa es que la normalización sea estable y que rechace
// todo lo que no es un origen.

test("acepta esquema + host y devuelve url.origin", () => {
  assert.equal(normalizeOrigin("https://ejemplo.com"), "https://ejemplo.com");
  assert.equal(normalizeOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(normalizeOrigin("https://sub.ejemplo.com.uy"), "https://sub.ejemplo.com.uy");
});

test("normaliza: minúsculas, barra final sola, puerto por defecto, espacios", () => {
  assert.equal(normalizeOrigin("https://Ejemplo.COM"), "https://ejemplo.com");
  assert.equal(normalizeOrigin("https://ejemplo.com/"), "https://ejemplo.com");
  assert.equal(normalizeOrigin("https://ejemplo.com:443"), "https://ejemplo.com");
  assert.equal(normalizeOrigin("http://ejemplo.com:80"), "http://ejemplo.com");
  assert.equal(normalizeOrigin("  https://ejemplo.com  "), "https://ejemplo.com");
  // Un puerto no default se conserva: es parte del origen.
  assert.equal(normalizeOrigin("https://ejemplo.com:8443"), "https://ejemplo.com:8443");
});

test("rechaza path, query y fragmento", () => {
  assert.equal(normalizeOrigin("https://ejemplo.com/widget"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com/a/b"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com?x=1"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com/?x=1"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com#top"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com/?"), null);
  assert.equal(normalizeOrigin("https://ejemplo.com/#"), null);
});

test("rechaza sin esquema, esquema no web, credenciales y basura", () => {
  assert.equal(normalizeOrigin("ejemplo.com"), null);
  assert.equal(normalizeOrigin("//ejemplo.com"), null);
  assert.equal(normalizeOrigin("ftp://ejemplo.com"), null);
  assert.equal(normalizeOrigin("javascript:alert(1)"), null);
  assert.equal(normalizeOrigin("https://user:pass@ejemplo.com"), null);
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin("   "), null);
  assert.equal(normalizeOrigin("no es una url"), null);
});

test("es idempotente: normalizar dos veces da lo mismo", () => {
  const una = normalizeOrigin("https://Ejemplo.com:443/");
  assert.ok(una);
  assert.equal(normalizeOrigin(una), una);
});
