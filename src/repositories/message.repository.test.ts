import assert from "node:assert/strict";
import { test } from "node:test";
import { estadosQueAvanzanA } from "./message.repository";

// ---------------------------------------------------------------------------
// WA-1 (pendientes post F1–F5 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)): el orden
// del estado de entrega. Un status de Meta solo se aplica si el estado actual
// está ANTES en el orden; el recorrido contra la base (el UPDATE condicional,
// la idempotencia, el aislamiento) está en
// src/controllers/whatsappWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

test("WA-1: PENDING < SENT < FAILED < DELIVERED < READ", () => {
  assert.deepEqual(estadosQueAvanzanA("SENT"), ["PENDING"]);
  assert.deepEqual(estadosQueAvanzanA("FAILED"), ["PENDING", "SENT"]);
  assert.deepEqual(estadosQueAvanzanA("DELIVERED"), ["PENDING", "SENT", "FAILED"]);
  assert.deepEqual(estadosQueAvanzanA("READ"), ["PENDING", "SENT", "FAILED", "DELIVERED"]);
});

test("WA-1: nada avanza a un estado igual o anterior al actual", () => {
  assert.ok(!estadosQueAvanzanA("DELIVERED").includes("READ"));
  assert.ok(!estadosQueAvanzanA("DELIVERED").includes("DELIVERED"));
  assert.ok(!estadosQueAvanzanA("FAILED").includes("DELIVERED"));
  assert.deepEqual(estadosQueAvanzanA("PENDING"), []);
});
