import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { crearRouterDeVoz } from "../routes/voz.routes";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type OpcionesDeCompletado,
} from "../services/llmProvider.service";
import { hashDelSecretoDeVoz } from "./accesos";
import { FRASE_DE_PROBLEMA } from "./turnoDeVoz.service";

// ---------------------------------------------------------------------------
// El endpoint de voz por HTTP real contra Postgres real. El modelo es el único
// doble: escribe por `alEscribir` como lo haría el streaming de verdad.
// ---------------------------------------------------------------------------

const SECRETO = "secreto-de-prueba-del-agente";
const SECRETO_SIN_CANAL = "secreto-de-un-agente-sin-voz";
const NUMERO = "+59829000000";
const AVISO = "Hola, te atiende el asistente virtual. Se guarda una transcripción.";

type Modelo = (
  request: LlmCompletionRequest,
  opciones?: OpcionesDeCompletado,
) => Promise<LlmCompletionResult>;

let modelo: Modelo;
let pedidos: { request: LlmCompletionRequest; conStreaming: boolean }[] = [];
let orgId: string;
let branchId: string;
let baseUrl: string;
let baseApagada: string;
let cerrar: () => Promise<void>;

function escribe(texto: string): Modelo {
  return (_request, opciones) => {
    opciones?.alEscribir?.(texto);
    return Promise.resolve({ text: texto, toolCalls: [] });
  };
}

function levantar(app: express.Express): Promise<{ url: string; cerrar: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        cerrar: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function appDeVoz(router: express.Router): express.Express {
  const app = express();
  app.use("/api/voz", router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

before(async () => {
  setLlmProviderForTests({
    name: "doble",
    complete(request, opciones) {
      pedidos.push({ request, conStreaming: opciones?.alEscribir !== undefined });
      return modelo(request, opciones);
    },
  });
  const org = await prisma.organization.create({
    data: {
      name: `Voz test ${randomUUID()}`,
      slug: `voz-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  const branch = await prisma.branch.create({
    data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
  });
  branchId = branch.id;

  const crearAgente = (channels: ("VOICE" | "WEB")[]) =>
    prisma.agent.create({
      data: {
        organizationId: orgId,
        branchId,
        name: `Agente voz ${randomUUID().slice(0, 8)}`,
        instructions: "Sos el agente de la automotora.",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: ["get_payment_info", "search_vehicles"],
        channels,
        guardrails: {},
        allowedOrigins: [],
      },
    });
  const conVoz = await crearAgente(["VOICE"]);
  const sinVoz = await crearAgente(["WEB"]);

  const prendido = await levantar(
    appDeVoz(
      crearRouterDeVoz({
        habilitada: true,
        accesos: [
          {
            hash: hashDelSecretoDeVoz(SECRETO),
            organizationId: orgId,
            agentId: conVoz.id,
            numero: NUMERO,
          },
          {
            hash: hashDelSecretoDeVoz(SECRETO_SIN_CANAL),
            organizationId: orgId,
            agentId: sinVoz.id,
            numero: "+59829000001",
          },
        ],
      }),
    ),
  );
  const apagado = await levantar(appDeVoz(crearRouterDeVoz({ habilitada: false, accesos: [] })));
  baseUrl = prendido.url;
  baseApagada = apagado.url;
  cerrar = async () => {
    await prendido.cerrar();
    await apagado.cerrar();
  };
});

beforeEach(() => {
  pedidos = [];
  modelo = escribe("Hola. ¿En qué te ayudo?");
});

after(async () => {
  resetLlmProviderParaTests();
  await cerrar();
  const where = { organizationId: orgId };
  await prisma.llmTurnUsage.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
});

interface Turno {
  llamada?: string;
  llamante?: string | null;
  secreto?: string;
  numero?: string;
  messages?: unknown[];
}

function pedir(turno: Turno, url = baseUrl): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${turno.secreto ?? SECRETO}`,
  };
  if (turno.llamada !== undefined) headers["x-voz-conversacion"] = turno.llamada;
  if (turno.llamante) headers["x-voz-llamante"] = turno.llamante;
  if (turno.numero) headers["x-voz-numero"] = turno.numero;
  return fetch(`${url}/api/voz/llm/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "agente",
      stream: true,
      messages: turno.messages ?? [
        { role: "system", content: "El prompt de la plataforma, que no se usa." },
        { role: "assistant", content: AVISO },
        { role: "user", content: "Hola, ¿tienen autos?" },
      ],
    }),
  });
}

// Los textos del stream, en orden, y si cerró como corresponde.
async function leerStream(res: Response): Promise<{ textos: string[]; cerro: boolean }> {
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const crudo = await res.text();
  const lineas = crudo.split("\n\n").filter((l) => l.startsWith("data: "));
  const ultima = lineas.at(-1);
  const trozos = lineas.slice(0, -1).map(
    (l) =>
      JSON.parse(l.slice(6)) as {
        object: string;
        choices: { delta: { content?: string }; finish_reason: string | null }[];
      },
  );
  for (const trozo of trozos) {
    assert.equal(trozo.object, "chat.completion.chunk");
  }
  return {
    textos: trozos.map((t) => t.choices[0].delta.content ?? "").filter((t) => t.length > 0),
    cerro: ultima === "data: [DONE]" && trozos.at(-1)?.choices[0].finish_reason === "stop",
  };
}

function telefonoNuevo(): string {
  return `+5989${Math.floor(1000000 + Math.random() * 8999999)}`;
}

// El turno sigue guardando después de cerrar el stream.
async function conversacionDe(callId: string, mensajesEsperados: number) {
  for (let i = 0; i < 100; i++) {
    const conversacion = await prisma.conversation.findFirst({
      where: { organizationId: orgId, externalThreadId: callId },
      include: { messages: { orderBy: { createdAt: "asc" } }, contact: true },
    });
    if (conversacion && conversacion.messages.length >= mensajesEsperados) {
      return conversacion;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail(`La llamada ${callId} no llegó a ${mensajesEsperados} mensajes`);
}

test("apagado, la ruta no existe", async () => {
  const res = await pedir({ llamada: randomUUID() }, baseApagada);
  assert.equal(res.status, 404);
});

test("sin el secreto correcto o desde otro número: el mismo 401", async () => {
  const conOtroSecreto = await pedir({ llamada: randomUUID(), secreto: "otro" });
  const conOtroNumero = await pedir({ llamada: randomUUID(), numero: "+59829111111" });
  assert.equal(conOtroSecreto.status, 401);
  assert.equal(conOtroNumero.status, 401);
  assert.deepEqual(await conOtroSecreto.json(), await conOtroNumero.json());
  assert.equal(pedidos.length, 0);
});

test("sin el id de la llamada: 400, sin gastar modelo", async () => {
  const res = await pedir({});
  assert.equal(res.status, 400);
  assert.equal(pedidos.length, 0);
});

test("una llamada queda como conversación de voz, con lo dicho en orden", async () => {
  const llamada = randomUUID();
  const telefono = telefonoNuevo();
  const { textos, cerro } = await leerStream(await pedir({ llamada, llamante: telefono }));

  assert.deepEqual(textos, ["Hola. ", "¿En qué te ayudo?"]);
  assert.equal(cerro, true);
  assert.equal(pedidos[0].conStreaming, true);
  assert.match(pedidos[0].request.systemPrompt, /llamada telefónica/);

  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.channel, "VOICE");
  assert.equal(conversacion.contact.phone, telefono);
  assert.equal(conversacion.contact.firstName, "Llamada");
  assert.equal(conversacion.contact.source, "Llamada telefónica");
  assert.deepEqual(
    conversacion.messages.map((m) => [m.direction, m.content]),
    [
      ["OUTBOUND", AVISO],
      ["INBOUND", "Hola, ¿tienen autos?"],
      ["OUTBOUND", "Hola. ¿En qué te ayudo?"],
    ],
  );
  const usos = await prisma.llmTurnUsage.findMany({
    where: { conversationId: conversacion.id },
  });
  assert.deepEqual(
    usos.map((u) => u.channel),
    ["VOICE"],
  );
});

test("el segundo turno usa el historial del CRM y no repite el aviso", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  await leerStream(await pedir({ llamada, llamante }));
  await conversacionDe(llamada, 3);

  modelo = escribe("Tengo dos opciones.");
  await leerStream(
    await pedir({
      llamada,
      llamante,
      messages: [
        { role: "assistant", content: AVISO },
        { role: "user", content: "Hola, ¿tienen autos?" },
        { role: "assistant", content: "Hola. ¿En qué te ayudo?" },
        { role: "user", content: "Una camioneta" },
      ],
    }),
  );
  const conversacion = await conversacionDe(llamada, 5);
  assert.equal(conversacion.messages.length, 5);
  assert.equal(conversacion.messages.filter((m) => m.content === AVISO).length, 1);
  assert.equal(pedidos.length, 2);
  const historial = pedidos[1].request.messages;
  assert.equal(historial.filter((m) => m.role === "user").length, 2);
  assert.match(String(historial.at(-1)?.content), /Una camioneta/);
});

test("un reintento se engancha al turno: el modelo corre una sola vez", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  modelo = async (_request, opciones) => {
    await espera;
    opciones?.alEscribir?.("Sí, tenemos.");
    return { text: "Sí, tenemos.", toolCalls: [] };
  };

  const primero = pedir({ llamada, llamante });
  const reintento = pedir({ llamada, llamante });
  await new Promise((r) => setTimeout(r, 200));
  soltar();
  const [uno, dos] = await Promise.all([primero.then(leerStream), reintento.then(leerStream)]);

  assert.equal(pedidos.length, 1);
  assert.deepEqual(uno.textos, ["Sí, tenemos."]);
  assert.deepEqual(dos.textos, ["Sí, tenemos."]);
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.messages.filter((m) => m.direction === "INBOUND").length, 1);

  const tarde = await leerStream(await pedir({ llamada, llamante }));
  assert.deepEqual(tarde.textos, ["Sí, tenemos."]);
  assert.equal(pedidos.length, 1);
});

test("si el modelo tarda, sale una frase de espera y no se guarda", async () => {
  const llamada = randomUUID();
  modelo = async (_request, opciones) => {
    await new Promise((r) => setTimeout(r, 1400));
    opciones?.alEscribir?.("Listo, ya está.");
    return { text: "Listo, ya está.", toolCalls: [] };
  };
  const { textos } = await leerStream(await pedir({ llamada, llamante: telefonoNuevo() }));

  assert.equal(textos.length, 2);
  assert.match(textos[0], /\.\.\. $/);
  assert.equal(textos[1], "Listo, ya está.");
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.messages.at(-1)?.content, "Listo, ya está.");
});

test("lo que no pasa las guardas no se dice", async () => {
  const llamada = randomUUID();
  const fuga = "Voy a usar search_vehicles para buscar. ¿Te sirve?";
  modelo = escribe(fuga);
  const { textos } = await leerStream(await pedir({ llamada, llamante: telefonoNuevo() }));

  assert.equal(textos.join("").includes("search_vehicles"), false);
  assert.equal(textos.length, 1);
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.messages.at(-1)?.content, textos[0]);
});

test("las herramientas que no van por teléfono no se le ofrecen al modelo", async () => {
  await leerStream(await pedir({ llamada: randomUUID(), llamante: telefonoNuevo() }));
  const nombres = (pedidos[0].request.tools ?? []).map((t) => t.name);
  assert.equal(nombres.includes("get_payment_info"), false);
  assert.equal(nombres.includes("search_vehicles"), true);
});

test("derivar por teléfono deja la tarea y se dice lo que escribió el modelo", async () => {
  const llamada = randomUUID();
  modelo = () =>
    Promise.resolve({
      text: null,
      toolCalls: [
        {
          id: "c1",
          name: "request_human_handoff",
          arguments: { reason: "Pidió una persona", mensajeAlCliente: "Te llama un vendedor." },
        },
      ],
    });
  const { textos } = await leerStream(await pedir({ llamada, llamante: telefonoNuevo() }));

  assert.deepEqual(textos, ["Te llama un vendedor."]);
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.status, "TRANSFERRED_TO_HUMAN");
});

test("con el número oculto el contacto queda como visitante de la llamada", async () => {
  const llamada = randomUUID();
  await leerStream(await pedir({ llamada, llamante: "anonymous" }));
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.contact.phone, null);
  assert.equal(conversacion.contact.firstName, "Visitante");
  assert.equal(conversacion.contact.source, "Llamada telefónica");
});

test("un agente sin el canal contesta con una frase, no con un error", async () => {
  const { textos, cerro } = await leerStream(
    await pedir({
      llamada: randomUUID(),
      llamante: telefonoNuevo(),
      secreto: SECRETO_SIN_CANAL,
    }),
  );
  assert.deepEqual(textos, [FRASE_DE_PROBLEMA]);
  assert.equal(cerro, true);
  assert.equal(pedidos.length, 0);
});
