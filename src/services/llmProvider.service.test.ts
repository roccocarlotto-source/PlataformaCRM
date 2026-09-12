import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LLM_PROVIDER_NAMES,
  LlmProviderError,
  crearProveedorOpenRouter,
  isLlmProviderName,
  type FetchLike,
  type LlmToolDefinition,
} from "./llmProvider.service";

// Unitarios, SIN RED Y SIN CLAVE REAL: la API de OpenRouter se mockea
// inyectando un `fetch` falso en la factory. Ningún test de este archivo llega
// a internet ni necesita OPENROUTER_API_KEY configurada — que es justamente por
// lo que llmProvider.service.ts no toca Postgres ni lee el entorno en la
// factory. Mismo patrón que googleCalendar.service.test.ts.

const CONFIG = {
  apiKey: "sk-or-clave-de-prueba",
  defaultModel: "proveedor/modelo-por-defecto:free",
  baseUrl: "https://openrouter.ai/api/v1",
};

interface LlamadaRegistrada {
  url: string;
  init: RequestInit;
}

// Arma un fetch falso que devuelve `respuesta` y registra con qué lo llamaron.
// El registro importa tanto como la respuesta: la mitad de lo que hay que
// verificar acá es QUÉ SE LE MANDA a OpenRouter, no solo cómo se interpreta lo
// que contesta.
function mockearFetch(respuesta: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  jsonInvalido?: boolean;
}): { fetch: FetchLike; llamadas: LlamadaRegistrada[] } {
  const llamadas: LlamadaRegistrada[] = [];

  const fetchFalso: FetchLike = (url, init) => {
    llamadas.push({ url, init });

    return Promise.resolve({
      ok: respuesta.ok ?? true,
      status: respuesta.status ?? 200,
      json: () =>
        respuesta.jsonInvalido
          ? Promise.reject(new Error("no es JSON"))
          : Promise.resolve(respuesta.json),
    } as Response);
  };

  return { fetch: fetchFalso, llamadas };
}

function cuerpoDe(llamada: LlamadaRegistrada): Record<string, unknown> {
  return JSON.parse(String(llamada.init.body));
}

// Una respuesta de OpenRouter con la forma de OpenAI, para no repetir el
// envoltorio choices[0].message en cada test.
function respuestaConMensaje(message: Record<string, unknown>) {
  return {
    id: "gen-123",
    model: CONFIG.defaultModel,
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }],
  };
}

const TOOL_CREAR_OPORTUNIDAD: LlmToolDefinition = {
  name: "create_opportunity",
  description: "Crea una oportunidad de venta para el contacto de la conversación.",
  parameters: {
    type: "object",
    properties: { title: { type: "string" }, amount: { type: "number" } },
    required: ["title"],
  },
};

const PEDIDO_BASICO = {
  systemPrompt: "Sos el agente comercial de la sucursal Centro.",
  messages: [{ role: "user" as const, content: "Hola, quiero cotizar un corte de pelo" }],
  tools: [],
};

// ---------------------------------------------------------------------------
// Cómo se arma el request
// ---------------------------------------------------------------------------

test("complete pega a POST {baseUrl}/chat/completions con la clave como Bearer", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "Hola" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(llamadas[0].init.method, "POST");

  const headers = llamadas[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-or-clave-de-prueba");
  assert.equal(headers["Content-Type"], "application/json");
});

test("una barra final en OPENROUTER_BASE_URL no duplica la barra en la URL", async () => {
  // OPENROUTER_BASE_URL es configurable por entorno y una barra final es el
  // error de tipeo más probable. "//chat/completions" es un 404 silencioso.
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({
    ...CONFIG,
    baseUrl: "https://openrouter.ai/api/v1/",
    fetch,
  }).complete(PEDIDO_BASICO);

  assert.equal(llamadas[0].url, "https://openrouter.ai/api/v1/chat/completions");
});

test("el system prompt va como PRIMER mensaje con role system, seguido del historial", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.deepEqual(cuerpo.messages, [
    { role: "system", content: "Sos el agente comercial de la sucursal Centro." },
    { role: "user", content: "Hola, quiero cotizar un corte de pelo" },
  ]);
});

test("usa el modelo por defecto de la configuración cuando el request no trae uno", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  assert.equal(cuerpoDe(llamadas[0]).model, CONFIG.defaultModel);
});

test("el modelo del request (Agent.modelName) pisa el default", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    model: "anthropic/claude-sonnet-4",
  });

  assert.equal(cuerpoDe(llamadas[0]).model, "anthropic/claude-sonnet-4");
});

test("SIN tools no manda `tools` ni `tool_choice` — un tools:[] rompe varios modelos", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.ok(!("tools" in cuerpo), "no debe mandar tools");
  assert.ok(!("tool_choice" in cuerpo), "no debe mandar tool_choice");
});

test("CON tools las manda en el formato function de OpenAI y tool_choice=auto", async () => {
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    tools: [TOOL_CREAR_OPORTUNIDAD],
  });

  const cuerpo = cuerpoDe(llamadas[0]);
  assert.deepEqual(cuerpo.tools, [
    {
      type: "function",
      function: {
        name: "create_opportunity",
        description: TOOL_CREAR_OPORTUNIDAD.description,
        parameters: TOOL_CREAR_OPORTUNIDAD.parameters,
      },
    },
  ]);
  assert.equal(cuerpo.tool_choice, "auto");
});

test("un turno previo del asistente con tool calls y su resultado se traducen a tool_calls / tool_call_id", async () => {
  // Es el ida y vuelta del paso 5-6 de §4: el modelo pidió una tool, el loop
  // la ejecutó y ahora le devuelve el resultado para que arme la respuesta
  // final. Los argumentos vuelven como STRING JSON, que es como el formato de
  // OpenAI los transporta — el loop nunca tiene que saberlo.
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "Listo" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    systemPrompt: "sys",
    tools: [TOOL_CREAR_OPORTUNIDAD],
    messages: [
      { role: "user", content: "Creame una oportunidad por 1000" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "call_1", name: "create_opportunity", arguments: { title: "Corte", amount: 1000 } },
        ],
      },
      { role: "tool", toolCallId: "call_1", content: JSON.stringify({ id: "opp-1" }) },
    ],
  });

  const mensajes = cuerpoDe(llamadas[0]).messages as Record<string, unknown>[];
  assert.deepEqual(mensajes[2], {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "create_opportunity", arguments: '{"title":"Corte","amount":1000}' },
      },
    ],
  });
  assert.deepEqual(mensajes[3], {
    role: "tool",
    tool_call_id: "call_1",
    content: '{"id":"opp-1"}',
  });
});

test("un mensaje del asistente SIN tool calls no lleva la clave tool_calls", async () => {
  // Un `tool_calls: []` explícito es rechazado por algunos proveedores.
  const { fetch, llamadas } = mockearFetch({ json: respuestaConMensaje({ content: "ok" }) });

  await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    messages: [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Buenas, ¿en qué te ayudo?" },
      { role: "user", content: "Quiero un turno" },
    ],
  });

  const mensajes = cuerpoDe(llamadas[0]).messages as Record<string, unknown>[];
  assert.deepEqual(mensajes[2], { role: "assistant", content: "Buenas, ¿en qué te ayudo?" });
});

// ---------------------------------------------------------------------------
// Cómo se interpreta la respuesta: texto final vs. tool calls
// ---------------------------------------------------------------------------

test("una respuesta de texto devuelve text y toolCalls vacío", async () => {
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({ content: "Un corte de pelo cuesta $1500." }),
  });

  const resultado = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  assert.deepEqual(resultado, { text: "Un corte de pelo cuesta $1500.", toolCalls: [] });
});

test("una respuesta con tool calls devuelve text null y los argumentos YA PARSEADOS", async () => {
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: null,
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: { name: "create_opportunity", arguments: '{"title":"Corte","amount":1500}' },
        },
      ],
    }),
  });

  const resultado = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    tools: [TOOL_CREAR_OPORTUNIDAD],
  });

  assert.equal(resultado.text, null);
  assert.deepEqual(resultado.toolCalls, [
    { id: "call_abc", name: "create_opportunity", arguments: { title: "Corte", amount: 1500 } },
  ]);
});

test("texto Y tool calls en el mismo turno: se devuelven los dos", async () => {
  // Varios modelos explican lo que van a hacer antes de pedir la tool. El
  // loop decide qué hacer con el texto intermedio; acá no se descarta nada.
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: "Dale, te la creo.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "create_opportunity", arguments: "{}" },
        },
      ],
    }),
  });

  const resultado = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    tools: [TOOL_CREAR_OPORTUNIDAD],
  });

  assert.equal(resultado.text, "Dale, te la creo.");
  assert.equal(resultado.toolCalls.length, 1);
});

test("varias tool calls en un turno conservan el orden y cada una su id", async () => {
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "get_availability", arguments: "{}" } },
        {
          id: "call_2",
          type: "function",
          function: { name: "create_opportunity", arguments: '{"title":"x"}' },
        },
      ],
    }),
  });

  const { toolCalls } = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    tools: [TOOL_CREAR_OPORTUNIDAD],
  });

  assert.deepEqual(
    toolCalls.map((tc) => [tc.id, tc.name]),
    [
      ["call_1", "get_availability"],
      ["call_2", "create_opportunity"],
    ],
  );
});

test("content vacío ('') se normaliza a null — una sola forma de 'no dijo nada'", async () => {
  const { fetch } = mockearFetch({ json: respuestaConMensaje({ content: "" }) });

  const resultado = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO);

  assert.equal(resultado.text, null);
});

test("arguments vacío ('') de una tool sin parámetros se lee como {}", async () => {
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "get_availability", arguments: "" } },
      ],
    }),
  });

  const { toolCalls } = await crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
    ...PEDIDO_BASICO,
    tools: [TOOL_CREAR_OPORTUNIDAD],
  });

  assert.deepEqual(toolCalls[0].arguments, {});
});

// ---------------------------------------------------------------------------
// Fallos — siempre LlmProviderError, nunca un cuerpo crudo
// ---------------------------------------------------------------------------

test("argumentos que no son JSON válido lanzan LlmProviderError con el nombre de la tool", async () => {
  // Un modelo puede escribir JSON roto. Al loop nunca le llega un
  // `arguments` a medias: falla acá, con el motivo.
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "create_opportunity", arguments: '{"title": "sin cerrar' },
        },
      ],
    }),
  });

  await assert.rejects(
    () =>
      crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
        ...PEDIDO_BASICO,
        tools: [TOOL_CREAR_OPORTUNIDAD],
      }),
    (err: unknown) =>
      err instanceof LlmProviderError &&
      err.message.includes("create_opportunity") &&
      err.message.includes("JSON"),
  );
});

test("una tool call sin id lanza — sin id no hay forma de devolverle el resultado al modelo", async () => {
  const { fetch } = mockearFetch({
    json: respuestaConMensaje({
      content: null,
      tool_calls: [{ type: "function", function: { name: "create_opportunity", arguments: "{}" } }],
    }),
  });

  await assert.rejects(
    () =>
      crearProveedorOpenRouter({ ...CONFIG, fetch }).complete({
        ...PEDIDO_BASICO,
        tools: [TOOL_CREAR_OPORTUNIDAD],
      }),
    (err: unknown) => err instanceof LlmProviderError && err.message.includes("sin id"),
  );
});

test("un error HTTP se describe con el message de OpenRouter, con status 502", async () => {
  const { fetch } = mockearFetch({
    ok: false,
    status: 402,
    json: { error: { message: "Insufficient credits", code: 402 } },
  });

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO),
    (err: unknown) =>
      err instanceof LlmProviderError &&
      err.statusCode === 502 &&
      err.message.includes("402") &&
      err.message.includes("Insufficient credits"),
  );
});

test("un 404 de modelo inexistente (el ':free' que salió del catálogo) llega con su motivo", async () => {
  // El caso que documenta OPENROUTER_MODEL en config/env.ts: el catálogo de
  // gratuitos cambia sin aviso. Que el mensaje diga qué pasó es lo que hace
  // que se arregle por configuración y no buscando en el log.
  const { fetch } = mockearFetch({
    ok: false,
    status: 404,
    json: { error: { message: "No endpoints found for google/gemma-4-31b-it:free." } },
  });

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO),
    (err: unknown) => err instanceof LlmProviderError && err.message.includes("No endpoints found"),
  );
});

test("un 200 con { error } en el cuerpo NO se toma como éxito", async () => {
  // OpenRouter responde así cuando el fallo es del proveedor de más abajo.
  const { fetch } = mockearFetch({
    json: { error: { message: "Provider returned error", code: 502 } },
  });

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO),
    (err: unknown) =>
      err instanceof LlmProviderError && err.message.includes("Provider returned error"),
  );
});

test("un 200 sin choices lanza en vez de devolver una respuesta vacía", async () => {
  const { fetch } = mockearFetch({ json: { id: "gen-1", choices: [] } });

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO),
    (err: unknown) => err instanceof LlmProviderError && err.message.includes("choices"),
  );
});

test("un error con cuerpo no interpretable no explota al describirlo", async () => {
  // Cuando el que responde no es OpenRouter sino un balanceador en el medio,
  // el cuerpo puede ser HTML. Describir el fallo no puede fallar a su vez.
  const { fetch } = mockearFetch({ ok: false, status: 502, jsonInvalido: true });

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch }).complete(PEDIDO_BASICO),
    (err: unknown) => err instanceof LlmProviderError && err.message.includes("502"),
  );
});

test("una falla de red se reporta como LlmProviderError con el detalle", async () => {
  const fetchQueFalla: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));

  await assert.rejects(
    () => crearProveedorOpenRouter({ ...CONFIG, fetch: fetchQueFalla }).complete(PEDIDO_BASICO),
    (err: unknown) => err instanceof LlmProviderError && err.message.includes("ECONNREFUSED"),
  );
});

// ---------------------------------------------------------------------------
// El catálogo de proveedores que valida el CRUD de agentes
// ---------------------------------------------------------------------------

test("el adaptador se identifica con el nombre del catálogo", () => {
  const proveedor = crearProveedorOpenRouter(CONFIG);
  assert.equal(proveedor.name, "openrouter");
  assert.ok(isLlmProviderName(proveedor.name));
  assert.deepEqual([...LLM_PROVIDER_NAMES], ["openrouter"]);
  assert.equal(isLlmProviderName("anthropic"), false, "todavía no hay adaptador de Anthropic");
});
