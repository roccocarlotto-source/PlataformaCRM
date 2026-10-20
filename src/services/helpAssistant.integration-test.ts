import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  contarPreguntasDesde,
  gastoDesde,
  guardarFeedback,
  registrarPregunta,
  type PreguntaARegistrar,
} from "../repositories/helpAssistantQuestion.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import { depsDelAsistente, preguntarAlAsistente } from "./helpAssistant.service";

// ---------------------------------------------------------------------------
// El asistente "¿Cómo se hace?" contra la base real: el registro, el tope del
// día (que no cuenta las que fallaron), el freno de gasto, el feedback solo de
// quien preguntó, y las rutas detrás de authenticate. El modelo es un doble: lo
// que se le manda lo prueba helpAssistant.service.test.ts.
// ---------------------------------------------------------------------------

let org: OrgDePrueba;
let baseUrl: string;
let cerrarApp: () => Promise<void>;

before(async () => {
  org = await crearOrgDePrueba("asistente-ayuda", "COMPLETA", "AUTOMOTORA", 2);
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      cerrarApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

after(async () => {
  if (cerrarApp) await cerrarApp();
  // Las preguntas se van con la organización (CASCADE).
  await borrarOrgDePrueba(org);
});

function fila(userId: string, cambios: Partial<PreguntaARegistrar> = {}): PreguntaARegistrar {
  return {
    organizationId: org.id,
    userId,
    industry: "AUTOMOTORA",
    edition: "COMPLETA",
    role: "ADMIN",
    screen: null,
    question: "¿Cómo invito a alguien?",
    sources: [],
    outcome: "ANSWERED",
    model: "doble/modelo",
    promptTokens: 100,
    completionTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.001,
    durationMs: 1200,
    ...cambios,
  };
}

function auth(userId: string): AuthContext {
  return {
    userId,
    organizationId: org.id,
    role: "ADMIN",
    email: "x@example.test",
    fullName: "Test",
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
  };
}

test("el registro, el tope sin las que fallaron y el gasto del día", async () => {
  const [u0] = org.authIds;
  const desde = new Date(Date.now() - 60_000);
  await registrarPregunta(fila(u0));
  await registrarPregunta(fila(u0, { outcome: "ERROR", costUsd: null }));
  await registrarPregunta(fila(u0, { outcome: "NOT_COVERED", costUsd: 0.002 }));

  assert.equal(await contarPreguntasDesde(u0, desde), 2, "la que falló no cuenta");
  assert.ok((await gastoDesde(desde)) >= 0.003 - 1e-9, "suma el costo; la sin costo cuenta 0");

  const guardada = await prisma.helpAssistantQuestion.findFirstOrThrow({
    where: { userId: u0, outcome: "NOT_COVERED" },
  });
  assert.equal(Number(guardada.costUsd), 0.002);
  assert.deepEqual(guardada.sources, []);
});

test("el feedback lo guarda solo quien preguntó", async () => {
  const [u0, u1] = org.authIds;
  const id = await registrarPregunta(fila(u0));
  assert.equal(await guardarFeedback(id, org.id, u1, "DOWN"), 0, "otro usuario no");
  assert.equal(await guardarFeedback(id, org.id, u0, "UP"), 1);
  const guardada = await prisma.helpAssistantQuestion.findUniqueOrThrow({ where: { id } });
  assert.equal(guardada.feedback, "UP");
});

test("el service con la base real: registra la pregunta y corta en el tope", async () => {
  const [, u1] = org.authIds;
  const deps = {
    ...depsDelAsistente,
    habilitado: true,
    topeDiario: 2,
    presupuestoDiarioUsd: 1_000_000,
    completar: () =>
      Promise.resolve({
        text: "1. Abrí **Usuarios**.\nFUENTES: usuarios-y-permisos#invitar\nTIPO: guia",
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 5, costUsd: 0.0001 },
      }),
  };
  const primera = await preguntarAlAsistente(auth(u1), { pregunta: "¿Cómo invito?" }, deps);
  assert.equal(primera.restantesHoy, 1);
  const guardada = await prisma.helpAssistantQuestion.findUniqueOrThrow({
    where: { id: primera.id },
  });
  assert.equal(guardada.outcome, "ANSWERED");
  assert.deepEqual(guardada.sources, ["usuarios-y-permisos#invitar"]);

  await preguntarAlAsistente(auth(u1), { pregunta: "¿Y cómo reenvío?" }, deps);
  await assert.rejects(
    preguntarAlAsistente(auth(u1), { pregunta: "¿Y la tercera?" }, deps),
    (err: unknown) => err instanceof AppError && err.statusCode === 429,
  );
});

test("por HTTP: con el interruptor global apagado (default) la pregunta es 404; el feedback de otro, 404", async () => {
  const [u0] = org.authIds;
  const [token0, token1] = org.tokens;
  const preguntar = await fetch(`${baseUrl}/api/help-assistant/questions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token0}`, "content-type": "application/json" },
    body: JSON.stringify({ pregunta: "¿Cómo invito a alguien?" }),
  });
  assert.equal(preguntar.status, 404);

  const id = await registrarPregunta(fila(u0));
  const feedback = (token: string) =>
    fetch(`${baseUrl}/api/help-assistant/questions/${id}/feedback`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ feedback: "DOWN" }),
    });
  assert.equal((await feedback(token1)).status, 404);
  assert.equal((await feedback(token0)).status, 204);

  const sinSesion = await fetch(`${baseUrl}/api/help-assistant/questions/${id}/feedback`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feedback: "UP" }),
  });
  assert.equal(sinSesion.status, 401);
});
