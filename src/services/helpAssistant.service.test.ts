import assert from "node:assert/strict";
import { test } from "node:test";
import type { PreguntaARegistrar } from "../repositories/helpAssistantQuestion.repository";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import {
  asistenteDisponible,
  preguntarAlAsistente,
  type DepsDelAsistente,
} from "./helpAssistant.service";
import type { LlmCompletionRequest, LlmCompletionResult } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El orden de los cortes del asistente "¿Cómo se hace?" y lo que viaja al
// modelo, sin base ni red: cada dependencia es un doble que registra con qué
// la llamaron. La guía es la real (docs/guia-de-uso/). Las consultas contra la
// base las cubre helpAssistant.integration-test.ts.
// ---------------------------------------------------------------------------

const AUTH: AuthContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "USER",
  // Valores que no aparecen en la guía (que usa "Ana Pérez" de ejemplo).
  email: "zoe.testeo@example.test",
  fullName: "Zoe Testeo",
  edition: "COMPLETA",
  industry: "AUTOMOTORA",
};

function armar(
  cambios: Partial<DepsDelAsistente> = {},
  respuesta: LlmCompletionResult | Error = {
    text: "1. Abrí **Contactos**.\nFUENTES: contactos-y-consultas#contactos\nTIPO: guia",
    toolCalls: [],
    usage: {
      promptTokens: 30_000,
      completionTokens: 200,
      costUsd: 0.004,
      cacheReadTokens: 29_000,
      cacheWriteTokens: 0,
    },
  },
) {
  const pedidos: LlmCompletionRequest[] = [];
  const registros: PreguntaARegistrar[] = [];
  const deps: DepsDelAsistente = {
    ahora: () => new Date("2026-10-20T15:00:00Z"),
    habilitado: true,
    modelo: "anthropic/claude-haiku-5.5",
    cachearPrompt: true,
    topeDiario: 20,
    presupuestoDiarioUsd: 5,
    zonaDeLaOrganizacion: () => Promise.resolve("America/Montevideo"),
    preguntasDesde: () => Promise.resolve(3),
    gastoDesde: () => Promise.resolve(0.5),
    esPlatformAdmin: () => Promise.resolve(false),
    tieneAgenteInterno: () => Promise.resolve(false),
    completar: (pedido) => {
      pedidos.push(pedido);
      return respuesta instanceof Error ? Promise.reject(respuesta) : Promise.resolve(respuesta);
    },
    registrar: (datos) => {
      registros.push(datos);
      return Promise.resolve("33333333-3333-4333-8333-333333333333");
    },
    ...cambios,
  };
  return { deps, pedidos, registros };
}

async function esperarAppError(fn: () => Promise<unknown>, status: number, code?: string) {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, status);
    if (code) assert.equal(err.details?.code, code);
    return true;
  });
}

test("con el interruptor global apagado es 404, sin llamar a nada", async () => {
  const { deps, pedidos, registros } = armar({ habilitado: false });
  await esperarAppError(() => preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps), 404);
  assert.equal(pedidos.length, 0);
  assert.equal(registros.length, 0);
});

test("con la organización apagada es 403 ASISTENTE_APAGADO", async () => {
  const { deps, pedidos } = armar();
  await esperarAppError(
    () =>
      preguntarAlAsistente({ ...AUTH, helpAssistantEnabled: false }, { pregunta: "hola" }, deps),
    403,
    "ASISTENTE_APAGADO",
  );
  assert.equal(pedidos.length, 0);
});

test("asistenteDisponible: los dos interruptores; sin el flag de la organización vale prendido", () => {
  assert.equal(asistenteDisponible(AUTH, true), true);
  assert.equal(asistenteDisponible({ ...AUTH, helpAssistantEnabled: false }, true), false);
  assert.equal(asistenteDisponible(AUTH, false), false);
});

test("con el gasto del día en el freno (o el freno en 0) es 503 ASISTENTE_EN_PAUSA", async () => {
  for (const cambios of [
    { gastoDesde: () => Promise.resolve(5) },
    { presupuestoDiarioUsd: 0 },
  ] as Partial<DepsDelAsistente>[]) {
    const { deps, pedidos } = armar(cambios);
    await esperarAppError(
      () => preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps),
      503,
      "ASISTENTE_EN_PAUSA",
    );
    assert.equal(pedidos.length, 0);
  }
});

test("el freno suma desde la medianoche UTC; el tope cuenta desde la medianoche de la organización", async () => {
  const desdes: { gasto?: Date; tope?: Date } = {};
  const { deps } = armar({
    gastoDesde: (desde) => {
      desdes.gasto = desde;
      return Promise.resolve(0);
    },
    preguntasDesde: (_userId, desde) => {
      desdes.tope = desde;
      return Promise.resolve(0);
    },
  });
  await preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps);
  assert.equal(desdes.gasto?.toISOString(), "2026-10-20T00:00:00.000Z");
  // Medianoche del 20/10 en Montevideo (UTC-3).
  assert.equal(desdes.tope?.toISOString(), "2026-10-20T03:00:00.000Z");
});

test("en el tope del día es 429 TOPE_DIARIO_ASISTENTE", async () => {
  const { deps, pedidos } = armar({ preguntasDesde: () => Promise.resolve(20) });
  await esperarAppError(
    () => preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps),
    429,
    "TOPE_DIARIO_ASISTENTE",
  );
  assert.equal(pedidos.length, 0);
});

test("camino feliz: la guía va cacheable, la pregunta enmascarada, y se registra con el costo", async () => {
  const { deps, pedidos, registros } = armar();
  const r = await preguntarAlAsistente(
    AUTH,
    { pregunta: "¿Cómo cargo a ana@example.com, tel 11 2345 6789?", pantalla: "contactos" },
    deps,
  );
  assert.equal(r.tipo, "ANSWERED");
  assert.equal(r.restantesHoy, 16);
  assert.match(r.respuesta, /Más en la guía/);

  const pedido = pedidos[0];
  // El índice (estable por vista) es lo que se cachea; el texto elegido por la
  // búsqueda va con el contexto, y trae el bloque de la pantalla.
  assert.match(pedido.systemPromptCacheable ?? "", /<indice>/);
  assert.doesNotMatch(pedido.systemPromptCacheable ?? "", /<guia>/);
  assert.match(pedido.systemPrompt, /<guia>/);
  assert.match(pedido.systemPrompt, /## Contactos \{#contactos\}/);
  assert.match(pedido.systemPrompt, /pantalla: Contactos/);
  assert.equal(pedido.model, "anthropic/claude-haiku-5.5");
  assert.deepEqual(pedido.tools, []);
  const ultima = pedido.messages.at(-1)?.content;
  assert.equal(ultima, "<pregunta>\n¿Cómo cargo a [email], tel [número]?\n</pregunta>");

  assert.equal(registros.length, 1);
  assert.equal(registros[0].question, "¿Cómo cargo a [email], tel [número]?");
  assert.equal(registros[0].outcome, "ANSWERED");
  assert.equal(registros[0].screen, "contactos");
  assert.deepEqual(registros[0].sources, ["contactos-y-consultas#contactos"]);
  assert.equal(registros[0].cacheReadTokens, 29_000);
  assert.equal(registros[0].costUsd, 0.004);
});

test("nada de la persona entra al prompt: ni su nombre ni su email", async () => {
  const { deps, pedidos } = armar();
  await preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps);
  const todo = JSON.stringify(pedidos[0]);
  assert.doesNotMatch(todo, /Zoe Testeo/);
  assert.doesNotMatch(todo, /zoe\.testeo/);
  assert.doesNotMatch(todo, new RegExp(AUTH.organizationId));
});

test("sin caché, todo va en el system prompt; una pantalla desconocida se ignora", async () => {
  const { deps, pedidos, registros } = armar({ cachearPrompt: false });
  await preguntarAlAsistente(AUTH, { pregunta: "hola", pantalla: "noExiste" }, deps);
  assert.equal(pedidos[0].systemPromptCacheable, undefined);
  assert.match(pedidos[0].systemPrompt, /<guia>/);
  assert.equal(registros[0].screen, null);
});

test("el historial: a lo sumo 3 pares, enmascarados", async () => {
  const { deps, pedidos } = armar();
  const historial = Array.from({ length: 5 }, (_, i) => ({
    pregunta: `pregunta ${String(i)} de ana@example.com`,
    respuesta: `respuesta ${String(i)}`,
  }));
  await preguntarAlAsistente(AUTH, { pregunta: "y ahora?", historial }, deps);
  const mensajes = pedidos[0].messages;
  assert.equal(mensajes.length, 7);
  assert.match(String(mensajes[0].content), /pregunta 2 de \[email\]/);
});

test("si el modelo falla: 502, y la pregunta queda como ERROR", async () => {
  const { deps, registros } = armar({}, new Error("se cayó"));
  await esperarAppError(
    () => preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps),
    502,
    "ASISTENTE_SIN_RESPUESTA",
  );
  assert.equal(registros[0].outcome, "ERROR");
});

test("una respuesta cortada por largo no se muestra a medias: 502 y ERROR", async () => {
  const { deps, registros } = armar({}, { text: "1. Abrí", toolCalls: [], cortadaPorLargo: true });
  await esperarAppError(
    () => preguntarAlAsistente(AUTH, { pregunta: "hola" }, deps),
    502,
    "ASISTENTE_SIN_RESPUESTA",
  );
  assert.equal(registros[0].outcome, "ERROR");
});

test("a un USER, un tema de administrador le llega como aviso, sin pasos", async () => {
  const { deps, pedidos } = armar();
  await preguntarAlAsistente(AUTH, { pregunta: "¿Cómo invito a alguien?" }, deps);
  const indice = pedidos[0].systemPromptCacheable ?? "";
  assert.match(indice, /- Invitar a una persona — lo hace un administrador\./);
  assert.doesNotMatch(indice, /usuarios-y-permisos#invitar/);
  assert.doesNotMatch(pedidos[0].systemPrompt, /\{#invitar\}/);
});

test("la sección Plataforma entra al prompt solo si el platform admin pregunta desde una pantalla de Plataforma", async () => {
  const conPlataforma = armar({ esPlatformAdmin: () => Promise.resolve(true) });
  await preguntarAlAsistente(AUTH, { pregunta: "hola", pantalla: "contactos" }, conPlataforma.deps);
  assert.doesNotMatch(
    conPlataforma.pedidos[0].systemPromptCacheable ?? "",
    /- Plataforma \(plataforma\)/,
  );

  await preguntarAlAsistente(
    AUTH,
    { pregunta: "hola", pantalla: "organizaciones" },
    conPlataforma.deps,
  );
  assert.match(conPlataforma.pedidos[1].systemPromptCacheable ?? "", /- Plataforma \(plataforma\)/);

  const comun = armar();
  await preguntarAlAsistente(AUTH, { pregunta: "hola", pantalla: "organizaciones" }, comun.deps);
  assert.doesNotMatch(comun.pedidos[0].systemPromptCacheable ?? "", /- Plataforma \(plataforma\)/);
});
