import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LlmProviderError,
  crearProveedorOpenRouter,
  type FetchLike,
  type LlmCompletionRequest,
} from "./llmProvider.service";

// El streaming del adaptador de OpenRouter (opcional, apagado por defecto: ver
// "STREAMING, OPCIONAL Y APAGADO POR DEFECTO" en llmProvider.service.ts). Sin
// red: el fetch falso devuelve un cuerpo SSE partido en los pedazos que elige
// cada test, para probar también los cortes a mitad de línea. El camino sin
// streaming lo cubre llmProvider.service.test.ts, que no cambió.

const CONFIG = {
  apiKey: "sk-or-clave-de-prueba",
  defaultModel: "proveedor/modelo:free",
  baseUrl: "https://openrouter.ai/api/v1",
  maxOutputTokens: 1000,
};

const REQUEST: LlmCompletionRequest = {
  systemPrompt: "Sos un asistente.",
  messages: [{ role: "user", content: "hola" }],
  tools: [
    {
      name: "search_vehicles",
      description: "Busca vehículos.",
      parameters: { type: "object", properties: { model: { type: "string" } } },
    },
  ],
};

interface Respuesta {
  status?: number;
  // Los pedazos del cuerpo, tal cual se mandan (pueden cortar líneas).
  pedazos?: string[];
  json?: unknown;
}

function mockearFetch(respuestas: Respuesta[]) {
  const cuerpos: Record<string, unknown>[] = [];
  let i = 0;
  const fetch: FetchLike = (_url, init) => {
    cuerpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    const status = r.status ?? 200;
    const codificador = new TextEncoder();
    const body =
      r.pedazos === undefined
        ? null
        : new ReadableStream<Uint8Array>({
            start(controller) {
              for (const pedazo of r.pedazos ?? []) controller.enqueue(codificador.encode(pedazo));
              controller.close();
            },
          });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      body,
      json: () => Promise.resolve(r.json ?? {}),
    } as unknown as Response);
  };
  return { fetch, cuerpos };
}

const evento = (dato: unknown) => `data: ${JSON.stringify(dato)}\n\n`;
const delta = (d: Record<string, unknown>, finish_reason: string | null = null) =>
  evento({ choices: [{ index: 0, delta: d, finish_reason }] });

test("sin alEscribir el cuerpo no lleva stream (el camino de siempre)", async () => {
  const { fetch, cuerpos } = mockearFetch([
    { json: { choices: [{ message: { content: "Hola" }, finish_reason: "stop" }] } },
  ]);
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST);
  assert.equal(r.text, "Hola");
  assert.equal("stream" in cuerpos[0], false);
});

test("con alEscribir: pide stream, entrega el texto por pedazos y devuelve el texto entero y el consumo", async () => {
  const { fetch, cuerpos } = mockearFetch([
    {
      pedazos: [
        ": OPENROUTER PROCESSING\n\n",
        delta({ role: "assistant", content: "Tengo " }),
        // Una línea partida en dos pedazos de la red.
        delta({ content: "tres Hilux" }).slice(0, 20),
        delta({ content: "tres Hilux" }).slice(20),
        delta({ content: "." }, "stop"),
        evento({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 6, cost: 0.0001 } }),
        "data: [DONE]\n\n",
      ],
    },
  ]);
  const fragmentos: string[] = [];
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
    alEscribir: (f) => fragmentos.push(f),
  });
  assert.equal(cuerpos[0].stream, true);
  assert.deepEqual(fragmentos, ["Tengo ", "tres Hilux", "."]);
  assert.equal(r.text, "Tengo tres Hilux.");
  assert.deepEqual(r.toolCalls, []);
  assert.deepEqual(r.usage, { promptTokens: 120, completionTokens: 6, costUsd: 0.0001 });
  assert.equal(r.cortadaPorLargo, undefined);
});

test("con alEscribir: arma las tool calls con los argumentos que llegan en pedazos, con CRLF", async () => {
  const conCrlf = (s: string) => s.replace(/\n/g, "\r\n");
  const { fetch } = mockearFetch([
    {
      pedazos: [
        conCrlf(
          delta({
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "search_vehicles", arguments: '{"mod' },
              },
            ],
          }),
        ),
        conCrlf(delta({ tool_calls: [{ index: 0, function: { arguments: 'el":"Hilux"}' } }] })),
        conCrlf(delta({}, "tool_calls")),
        conCrlf("data: [DONE]\n\n"),
      ],
    },
  ]);
  const fragmentos: string[] = [];
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
    alEscribir: (f) => fragmentos.push(f),
  });
  assert.deepEqual(fragmentos, []);
  assert.equal(r.text, null);
  assert.deepEqual(r.toolCalls, [
    { id: "call_1", name: "search_vehicles", arguments: { model: "Hilux" } },
  ]);
});

test("con alEscribir: cortada por largo, el texto queda marcado y las tool calls se descartan", async () => {
  const { fetch } = mockearFetch([
    {
      pedazos: [
        delta({ content: "Te cuento que" }),
        delta(
          {
            tool_calls: [
              { index: 0, id: "c", function: { name: "search_vehicles", arguments: "{" } },
            ],
          },
          "length",
        ),
        "data: [DONE]\n\n",
      ],
    },
  ]);
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
    alEscribir: () => undefined,
  });
  assert.equal(r.cortadaPorLargo, true);
  assert.equal(r.text, "Te cuento que");
  assert.deepEqual(r.toolCalls, []);
});

test("con alEscribir: un error a mitad del streaming es un LlmProviderError", async () => {
  const { fetch } = mockearFetch([
    {
      pedazos: [
        delta({ content: "Hola" }),
        evento({ error: { message: "Provider returned error", code: 502 } }),
      ],
    },
  ]);
  await assert.rejects(
    crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
      alEscribir: () => undefined,
    }),
    (err: unknown) =>
      err instanceof LlmProviderError && /Provider returned error/.test(err.message),
  );
});

test("con alEscribir: un evento que no es JSON, o un streaming sin choices, es un LlmProviderError", async () => {
  for (const pedazos of [["data: {roto\n\n"], ["data: [DONE]\n\n"], []]) {
    const { fetch } = mockearFetch([{ pedazos }]);
    await assert.rejects(
      crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
        alEscribir: () => undefined,
      }),
      LlmProviderError,
    );
  }
});

test("con alEscribir: un 429 antes de empezar se reintenta como siempre", async () => {
  const { fetch, cuerpos } = mockearFetch([
    { status: 429, json: { error: { message: "Retry shortly." } } },
    { pedazos: [delta({ content: "Listo" }, "stop"), "data: [DONE]\n\n"] },
  ]);
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
    alEscribir: () => undefined,
  });
  assert.equal(cuerpos.length, 2);
  assert.equal(r.text, "Listo");
});

test("con alEscribir: sin [DONE], el fin del cuerpo cierra igual (último evento sin salto de línea)", async () => {
  const { fetch } = mockearFetch([
    { pedazos: [delta({ content: "Hola" }), 'data: {"choices":[{"delta":{"content":"!"}}]}'] },
  ]);
  const r = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
    alEscribir: () => undefined,
  });
  assert.equal(r.text, "Hola!");
});

test("con alEscribir: la conexión que se corta a mitad es un LlmProviderError, no se reintenta", async () => {
  let llamadas = 0;
  const fetch: FetchLike = () => {
    llamadas++;
    const codificador = new TextEncoder();
    // El primer pedazo llega; en la lectura siguiente, la conexión se corta.
    let lecturas = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (lecturas++ === 0) {
          controller.enqueue(codificador.encode(delta({ content: "Hola" })));
        } else {
          controller.error(new Error("socket hang up"));
        }
      },
    });
    return Promise.resolve({ ok: true, status: 200, body } as unknown as Response);
  };
  const fragmentos: string[] = [];
  await assert.rejects(
    crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(REQUEST, {
      alEscribir: (f) => fragmentos.push(f),
    }),
    (err: unknown) => err instanceof LlmProviderError && /se cortó/i.test(err.message),
  );
  assert.equal(llamadas, 1);
  assert.deepEqual(fragmentos, ["Hola"]);
});
