import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { InternalAgent, InternalAgentMessage } from "@prisma/client";
import { logger } from "../lib/logger";
import type { CreateInternalAgentMessageData } from "../repositories/internalAgent.repository";
import { AppError } from "../utils/AppError";
import { MAX_TOOL_ROUNDS_PER_TURN, VENTANA_DE_MENSAJES } from "./agentOrchestration.service";
import type { ContextoDeEjecucionDeToolInterna, ToolInterna } from "./internalAgentTools.service";
import {
  INSTRUCCION_INTERNA_BASE,
  MENSAJE_SIN_AGENTE_INTERNO,
  MENSAJE_TURNO_SIN_RESPUESTA,
  aHistorialInterno,
  runInternalAgentTurn,
  type DependenciasDelTurnoInterno,
} from "./internalAgentOrchestration.service";
import {
  LlmProviderError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Ítem 179: el loop del agente interno entero, sin base — un LlmProvider
// guionado (mismo doble que agentOrchestration.integration-test.ts) y las
// dependencias de persistencia y catálogo en memoria. Contra Postgres real está
// en internalAgent.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = randomUUID();
const USER = randomUUID();
const AHORA = new Date("2026-10-01T15:00:00.000Z");

function agente(extra: Partial<InternalAgent> = {}): InternalAgent {
  return {
    id: randomUUID(),
    organizationId: ORG,
    name: "Asistente interno",
    instructions: "Sos el asistente del equipo de AutoMax.",
    modelProvider: "openrouter",
    modelName: "modelo-de-prueba",
    enabledTools: ["tool_de_prueba"],
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

// El doble del proveedor: devuelve el guion en orden y repite la última
// respuesta cuando se agota (lo que permite agotar el tope de rondas).
function proveedor(guion: LlmCompletionResult[]) {
  const requests: LlmCompletionRequest[] = [];
  const llm: LlmProvider = {
    name: "doble",
    complete(request) {
      // Copia: el loop sigue empujando al mismo array después.
      requests.push({ ...request, messages: [...request.messages] });
      return Promise.resolve(guion[Math.min(requests.length - 1, guion.length - 1)]);
    },
  };
  return { llm, requests };
}

const texto = (t: string): LlmCompletionResult => ({ text: t, toolCalls: [] });
const pideTool = (name: string, args: Record<string, unknown> = {}): LlmCompletionResult => ({
  text: null,
  toolCalls: [{ id: randomUUID(), name, arguments: args }],
});

interface ToolEspia extends ToolInterna {
  llamadas: { args: Record<string, unknown>; contexto: ContextoDeEjecucionDeToolInterna }[];
}

function toolDePrueba(nombre = "tool_de_prueba"): ToolEspia {
  const llamadas: ToolEspia["llamadas"] = [];
  return {
    llamadas,
    definition: {
      name: nombre,
      description: "Una tool de prueba.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    ejecutar(args, contexto) {
      llamadas.push({ args, contexto });
      return Promise.resolve({ ok: true, data: { hecho: true } });
    },
  };
}

// Persistencia en memoria. `previos` es el hilo que ya existía.
function dependencias(
  opciones: {
    agente?: InternalAgent | null;
    previos?: Pick<InternalAgentMessage, "senderType" | "content">[];
    catalogo?: ToolInterna[];
  } = {},
) {
  const guardados: CreateInternalAgentMessageData[] = [];
  const ventanas: number[] = [];
  const catalogo = opciones.catalogo ?? [toolDePrueba()];
  const deps: DependenciasDelTurnoInterno = {
    leerAgente: () => Promise.resolve(opciones.agente === undefined ? agente() : opciones.agente),
    guardarMensaje: (data) => {
      guardados.push(data);
      return Promise.resolve({
        id: randomUUID(),
        createdAt: AHORA,
        toolCalls: null,
        ...data,
      } as InternalAgentMessage);
    },
    leerVentana: (_org, _agente, _user, take) => {
      ventanas.push(take);
      const hilo = [
        ...(opciones.previos ?? []),
        ...guardados.map((g) => ({ senderType: g.senderType, content: g.content })),
      ];
      return Promise.resolve(hilo.slice(-take) as InternalAgentMessage[]);
    },
    leerZona: () => Promise.resolve("America/Montevideo"),
    tools: (enabled) => catalogo.filter((t) => enabled.includes(t.definition.name)),
    ahora: () => AHORA,
  };
  return { deps, guardados, ventanas };
}

const ENTRADA = {
  organizationId: ORG,
  userId: USER,
  userFullName: "Laura Gómez",
  texto: "¿Qué turnos hay hoy?",
};

test("sin agente interno configurado: 404 con el mensaje claro, y no se guarda nada", async () => {
  const { deps, guardados } = dependencias({ agente: null });
  const { llm, requests } = proveedor([texto("no debería llamarse")]);

  await assert.rejects(runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps }), (err) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 404);
    assert.equal(err.message, MENSAJE_SIN_AGENTE_INTERNO);
    return true;
  });
  assert.equal(guardados.length, 0);
  assert.equal(requests.length, 0);
});

test("respuesta directa: guarda USER y después AGENT, sin toolCalls", async () => {
  const { deps, guardados } = dependencias();
  const { llm } = proveedor([texto("Hoy no hay turnos.")]);

  const { mensaje, toolCalls } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  assert.deepEqual(
    guardados.map((g) => [g.senderType, g.content, g.userId, g.organizationId]),
    [
      ["USER", ENTRADA.texto, USER, ORG],
      ["AGENT", "Hoy no hay turnos.", USER, ORG],
    ],
  );
  assert.equal(guardados[1].toolCalls, undefined);
  assert.equal(mensaje.content, "Hoy no hay turnos.");
  assert.equal(mensaje.senderType, "AGENT");
  assert.deepEqual(toolCalls, []);
});

test("el pedido al modelo: instructions, la base interna, la persona, la fecha, el modelo y solo las tools habilitadas", async () => {
  const habilitada = toolDePrueba("tool_de_prueba");
  const apagada = toolDePrueba("otra_tool");
  const { deps } = dependencias({ catalogo: [habilitada, apagada] });
  const { llm, requests } = proveedor([texto("ok")]);

  await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  const [request] = requests;
  assert.ok(request.systemPrompt.startsWith("Sos el asistente del equipo de AutoMax."));
  assert.ok(request.systemPrompt.includes(INSTRUCCION_INTERNA_BASE));
  assert.match(request.systemPrompt, /se llama Laura Gómez/);
  // 15:00Z en Montevideo son las 12:00 con offset -03:00.
  assert.match(request.systemPrompt, /2026-10-01T12:00:00-03:00/);
  assert.equal(request.model, "modelo-de-prueba");
  assert.deepEqual(
    request.tools.map((t) => t.name),
    ["tool_de_prueba"],
  );
});

test("la ventana: se pide con VENTANA_DE_MENSAJES e incluye el mensaje recién guardado, como turno de user", async () => {
  const { deps, ventanas } = dependencias({
    previos: [
      { senderType: "USER", content: "Hola" },
      { senderType: "AGENT", content: "Hola, ¿en qué te ayudo?" },
    ],
  });
  const { llm, requests } = proveedor([texto("ok")]);

  await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  assert.deepEqual(ventanas, [VENTANA_DE_MENSAJES]);
  assert.deepEqual(requests[0].messages, [
    { role: "user", content: "Hola" },
    { role: "assistant", content: "Hola, ¿en qué te ayudo?" },
    { role: "user", content: ENTRADA.texto },
  ]);
});

test("aHistorialInterno descarta los mensajes vacíos", () => {
  assert.deepEqual(
    aHistorialInterno([
      { senderType: "USER", content: "  " },
      { senderType: "AGENT", content: "Listo" },
    ]),
    [{ role: "assistant", content: "Listo" }],
  );
});

test("tool call: se ejecuta con {organizationId, userId}, el resultado vuelve al modelo y queda auditada", async () => {
  const tool = toolDePrueba();
  const { deps, guardados } = dependencias({ catalogo: [tool] });
  const { llm, requests } = proveedor([
    pideTool("tool_de_prueba", { algo: 1 }),
    texto("Listo, hecho."),
  ]);

  const { mensaje, toolCalls } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  assert.equal(tool.llamadas.length, 1);
  assert.deepEqual(tool.llamadas[0].args, { algo: 1 });
  assert.deepEqual(tool.llamadas[0].contexto, { organizationId: ORG, userId: USER });

  assert.equal(requests.length, 2);
  const ultimo = requests[1].messages.at(-1);
  assert.deepEqual(
    ultimo && { role: ultimo.role, content: "content" in ultimo && ultimo.content },
    {
      role: "tool",
      content: JSON.stringify({ ok: true, data: { hecho: true } }),
    },
  );

  assert.equal(mensaje.content, "Listo, hecho.");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].allowed, true);
  assert.deepEqual(toolCalls[0].result, { ok: true, data: { hecho: true } });
  assert.deepEqual(guardados[1].toolCalls, toolCalls);
});

test("una tool que no está habilitada no se ejecuta: allowed false y el modelo lo lee", async () => {
  const apagada = toolDePrueba("otra_tool");
  const { deps } = dependencias({ catalogo: [toolDePrueba(), apagada] });
  const { llm, requests } = proveedor([pideTool("otra_tool"), texto("No puedo hacer eso.")]);

  const { toolCalls } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  assert.equal(apagada.llamadas.length, 0);
  assert.equal(toolCalls[0].allowed, false);
  assert.match(toolCalls[0].reason ?? "", /no está habilitada/);
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /no está habilitada/);
});

test("el nombre con prefijo de namespace se canoniza (ítem 90)", async () => {
  const tool = toolDePrueba();
  const { deps } = dependencias({ catalogo: [tool] });
  const { llm } = proveedor([pideTool("default_api.tool_de_prueba"), texto("ok")]);

  const { toolCalls } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

  assert.equal(tool.llamadas.length, 1);
  assert.equal(toolCalls[0].name, "tool_de_prueba");
});

test("tope de rondas: tras MAX_TOOL_ROUNDS_PER_TURN llamadas sin respuesta, el mensaje fijo", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  try {
    const tool = toolDePrueba();
    const { deps, guardados } = dependencias({ catalogo: [tool] });
    const { llm, requests } = proveedor([pideTool("tool_de_prueba")]);

    const { mensaje, toolCalls } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

    assert.equal(requests.length, MAX_TOOL_ROUNDS_PER_TURN);
    assert.equal(mensaje.content, MENSAJE_TURNO_SIN_RESPUESTA);
    assert.equal(toolCalls.length, MAX_TOOL_ROUNDS_PER_TURN);
    // La auditoría de lo que sí se intentó se guarda igual.
    assert.equal((guardados[1].toolCalls as unknown[]).length, MAX_TOOL_ROUNDS_PER_TURN);
    assert.equal(warn.mock.callCount(), 1);
  } finally {
    warn.mock.restore();
  }
});

test("un modelo que no devuelve nada también agota el tope, no cuelga", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  try {
    const { deps } = dependencias();
    const { llm, requests } = proveedor([{ text: null, toolCalls: [] }]);

    const { mensaje } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

    assert.equal(requests.length, MAX_TOOL_ROUNDS_PER_TURN);
    assert.equal(mensaje.content, MENSAJE_TURNO_SIN_RESPUESTA);
  } finally {
    warn.mock.restore();
  }
});

test("el proveedor caído (LlmProviderError): el mensaje fijo, y el hilo queda con respuesta", async () => {
  const error = mock.method(logger, "error", () => undefined);
  try {
    const { deps, guardados } = dependencias();
    const llm: LlmProvider = {
      name: "caido",
      complete: () => Promise.reject(new LlmProviderError("OpenRouter no respondió")),
    };

    const { mensaje } = await runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps });

    assert.equal(mensaje.content, MENSAJE_TURNO_SIN_RESPUESTA);
    assert.deepEqual(
      guardados.map((g) => g.senderType),
      ["USER", "AGENT"],
    );
  } finally {
    error.mock.restore();
  }
});

test("un error que NO es del proveedor se propaga (no se disfraza de respuesta)", async () => {
  const { deps } = dependencias();
  const llm: LlmProvider = {
    name: "roto",
    complete: () => Promise.reject(new TypeError("bug")),
  };

  await assert.rejects(runInternalAgentTurn(ENTRADA, { llmProvider: llm, deps }), TypeError);
});
