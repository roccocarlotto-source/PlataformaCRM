import assert from "node:assert/strict";
import { test } from "node:test";
import { WhatsappGraphError } from "../services/whatsappGraph.service";
import { AppError } from "../utils/AppError";
import {
  clasificarFallo,
  ErrorDeEnvio,
  ErrorPermanenteDelJob,
  resolverFalloDelJob,
} from "./agentInboundWorker";

// ---------------------------------------------------------------------------
// Las decisiones puras del worker de la cola de WhatsApp (ítem 125): qué se
// reintenta y cuándo. El recorrido completo contra la base está en
// src/controllers/whatsappWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const LIMITES = { maxIntentos: 5, backoff: { baseMs: 15_000, topeMs: 300_000 } };
const AHORA = new Date("2026-09-24T12:00:00Z");

test("clasificarFallo: un AppError de negocio (4xx) es permanente; un 5xx no", () => {
  assert.equal(clasificarFallo(new AppError("El agente está desactivado", 400)), "PERMANENTE");
  assert.equal(clasificarFallo(new AppError("Agente no encontrado", 404)), "PERMANENTE");
  assert.equal(clasificarFallo(new AppError("se cayó algo", 502)), "TRANSITORIO");
});

test("clasificarFallo: un envío rechazado por Meta usa el mismo corte que el proveedor de LLM", () => {
  const envio = (status: number) => new ErrorDeEnvio(new WhatsappGraphError(status, "x"));
  assert.equal(clasificarFallo(envio(400)), "PERMANENTE");
  assert.equal(clasificarFallo(envio(401)), "PERMANENTE");
  assert.equal(clasificarFallo(envio(429)), "TRANSITORIO");
  assert.equal(clasificarFallo(envio(503)), "TRANSITORIO");
  // Sin respuesta de Meta (red, timeout): no hay status, se reintenta.
  assert.equal(clasificarFallo(new ErrorDeEnvio(new Error("fetch failed"))), "TRANSITORIO");
});

test("clasificarFallo: un job sin sus datos es permanente; un error cualquiera es transitorio", () => {
  assert.equal(clasificarFallo(new ErrorPermanenteDelJob("no existe")), "PERMANENTE");
  assert.equal(clasificarFallo(new Error("connection terminated")), "TRANSITORIO");
  assert.equal(clasificarFallo("algo raro"), "TRANSITORIO");
});

test("resolverFalloDelJob: el primer fallo espera la base, y la espera se duplica", () => {
  const primero = resolverFalloDelJob(1, "TRANSITORIO", AHORA, LIMITES);
  assert.deepEqual(primero, {
    estado: "REINTENTAR",
    nextAttemptAt: new Date(AHORA.getTime() + 15_000),
  });
  const tercero = resolverFalloDelJob(3, "TRANSITORIO", AHORA, LIMITES);
  assert.deepEqual(tercero, {
    estado: "REINTENTAR",
    nextAttemptAt: new Date(AHORA.getTime() + 60_000),
  });
});

test("resolverFalloDelJob: al agotar los intentos, o ante un error permanente, FAILED", () => {
  assert.deepEqual(resolverFalloDelJob(5, "TRANSITORIO", AHORA, LIMITES), { estado: "FAILED" });
  assert.deepEqual(resolverFalloDelJob(1, "PERMANENTE", AHORA, LIMITES), { estado: "FAILED" });
});
