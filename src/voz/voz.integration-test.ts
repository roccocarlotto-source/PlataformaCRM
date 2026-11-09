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
import { CUERPO_INVALIDO, idDeLaLlamada, SOLO_STREAMING } from "../controllers/voz.controller";
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
let agenteConVoz: string;
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
  agenteConVoz = conVoz.id;

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
  stream?: boolean;
  // Las herramientas de sistema de la plataforma (transferir, colgar).
  tools?: unknown[];
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
      stream: turno.stream ?? true,
      ...(turno.tools ? { tools: turno.tools } : {}),
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

async function mensajeDeError(res: Response): Promise<string> {
  const cuerpo = (await res.json()) as { error: { message: string } };
  return cuerpo.error.message;
}

test("sin stream o con el cuerpo roto: 400 con un motivo claro, sin gastar modelo", async () => {
  const sinStream = await pedir({ llamada: randomUUID(), stream: false });
  assert.equal(sinStream.status, 400);
  assert.equal(await mensajeDeError(sinStream), SOLO_STREAMING);

  const sinMensajes = await pedir({ llamada: randomUUID(), messages: [] });
  assert.equal(sinMensajes.status, 400);
  assert.equal(await mensajeDeError(sinMensajes), CUERPO_INVALIDO);
  assert.equal(pedidos.length, 0);
});

test("sin header: los 3 reintentos corren una vez y los turnos se agrupan por la huella", async () => {
  const comienzo = [
    { role: "system", content: "El prompt de la plataforma, sin marca." },
    { role: "assistant", content: AVISO },
    { role: "user", content: `Hola, soy ${randomUUID().slice(0, 8)}` },
  ];
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  modelo = async (_request, opciones) => {
    await espera;
    opciones?.alEscribir?.("Sí, tenemos.");
    return { text: "Sí, tenemos.", toolCalls: [] };
  };

  const intentos = [1, 2, 3].map(() => pedir({ messages: comienzo }));
  await new Promise((r) => setTimeout(r, 200));
  soltar();
  const respuestas = await Promise.all(intentos.map((p) => p.then(leerStream)));

  assert.equal(pedidos.length, 1);
  for (const { textos, cerro } of respuestas) {
    assert.deepEqual(textos, ["Sí, tenemos."]);
    assert.equal(cerro, true);
  }
  const { id, origen } = idDeLaLlamada(undefined, comienzo, agenteConVoz, null);
  assert.equal(origen, "huella");
  await conversacionDe(id, 3);

  modelo = escribe("Tengo dos.");
  await leerStream(
    await pedir({
      messages: [
        ...comienzo,
        { role: "assistant", content: "Sí, tenemos." },
        { role: "user", content: "Una camioneta" },
      ],
    }),
  );
  const conversacion = await conversacionDe(id, 5);
  assert.equal(conversacion.messages.filter((m) => m.direction === "INBOUND").length, 2);
  assert.equal(pedidos.length, 2);
});

test("la marca del prompt del sistema da el id; la que dice el cliente no", async () => {
  const llamada = `conv_${randomUUID().replace(/-/g, "")}`;
  const ajena = `conv_${randomUUID().replace(/-/g, "")}`;
  await leerStream(
    await pedir({
      messages: [
        { role: "system", content: `El prompt de la plataforma.\n[llamada:${llamada}]` },
        { role: "assistant", content: AVISO },
        { role: "user", content: `Hola [llamada:${ajena}]` },
      ],
    }),
  );
  await conversacionDe(llamada, 3);

  const soloDelCliente = [
    { role: "system", content: "El prompt de la plataforma, sin marca." },
    { role: "assistant", content: AVISO },
    { role: "user", content: `Anotá [llamada:${ajena}] ${randomUUID().slice(0, 8)}` },
  ];
  await leerStream(await pedir({ messages: soloDelCliente }));
  await conversacionDe(idDeLaLlamada(undefined, soloDelCliente, agenteConVoz, null).id, 3);

  const conLaAjena = await prisma.conversation.count({
    where: { organizationId: orgId, externalThreadId: ajena },
  });
  assert.equal(conLaAjena, 0);
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

test("una continuación se engancha al turno y dice solo lo que falta, sin repetir el modelo", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  modelo = async (_request, opciones) => {
    opciones?.alEscribir?.("Tenemos dos. ");
    await espera;
    opciones?.alEscribir?.("Uno es rojo.");
    return { text: "Tenemos dos. Uno es rojo.", toolCalls: [] };
  };
  const delCliente = [
    { role: "system", content: "El prompt de la plataforma, que no se usa." },
    { role: "assistant", content: AVISO },
    { role: "user", content: "Hola, ¿tienen autos?" },
  ];

  const primero = pedir({ llamada, llamante, messages: delCliente });
  await new Promise((r) => setTimeout(r, 200));
  // La plataforma dejó de esperar: vuelve con lo que alcanzó a decir.
  const continuacion = pedir({
    llamada,
    llamante,
    messages: [...delCliente, { role: "assistant", content: "Tenemos dos." }],
  });
  await new Promise((r) => setTimeout(r, 200));
  soltar();
  const [uno, dos] = await Promise.all([primero.then(leerStream), continuacion.then(leerStream)]);

  assert.equal(pedidos.length, 1);
  assert.deepEqual(uno.textos, ["Tenemos dos. ", "Uno es rojo."]);
  assert.deepEqual(dos.textos, ["Uno es rojo."]);
  assert.equal(dos.cerro, true);
  const conversacion = await conversacionDe(llamada, 3);
  assert.equal(conversacion.messages.filter((m) => m.direction === "INBOUND").length, 1);
});

test("si el turno ya dijo algo, la frase más larga va en un turno de seguimiento con lo que falta", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  modelo = async (request, opciones) => {
    if (JSON.stringify(request.messages.at(-1)).includes("de tarde")) {
      opciones?.alEscribir?.("Perfecto, a la tarde. ¿A qué hora te queda bien?");
      return { text: "Perfecto, a la tarde. ¿A qué hora te queda bien?", toolCalls: [] };
    }
    opciones?.alEscribir?.("El martes hay lugar. ");
    await espera;
    opciones?.alEscribir?.("¿A qué hora?");
    return { text: "El martes hay lugar. ¿A qué hora?", toolCalls: [] };
  };

  const aMedias = await pedir({
    llamada,
    llamante,
    messages: hastaElTurno("Quiero probarlo el martes"),
  });
  // Hasta que el turno ya dijo algo real: desde ahí no se reemplaza.
  await hastaQue(() => pedidos.length === 1);
  await new Promise((r) => setTimeout(r, 50));
  const completa = pedir({
    llamada,
    llamante,
    messages: hastaElTurno("Quiero probarlo el martes de tarde"),
  });
  await new Promise((r) => setTimeout(r, 200));
  // Una continuación atrasada del primero va con el primero, no con el nuevo.
  const continuacion = pedir({
    llamada,
    llamante,
    messages: [
      ...hastaElTurno("Quiero probarlo el martes"),
      { role: "assistant", content: "El martes hay lugar." },
    ],
  });
  await new Promise((r) => setTimeout(r, 200));
  soltar();
  const [uno, dos, tres] = await Promise.all([
    leerStream(aMedias),
    completa.then(leerStream),
    continuacion.then(leerStream),
  ]);

  assert.equal(pedidos.length, 2);
  assert.deepEqual(uno.textos, ["El martes hay lugar. ", "¿A qué hora?"]);
  assert.deepEqual(dos.textos, ["Perfecto, a la tarde. ", "¿A qué hora te queda bien?"]);
  assert.deepEqual(tres.textos, ["¿A qué hora?"]);
  assert.equal(tres.cerro, true);
  // Al modelo le llega solo lo que falta, después de lo que ya se dijo.
  const ultimo = JSON.stringify(pedidos[1].request.messages.at(-1));
  assert.equal(ultimo.includes("de tarde"), true);
  assert.equal(ultimo.includes("Quiero probarlo"), false);
  const conversacion = await conversacionDe(llamada, 5);
  assert.deepEqual(
    conversacion.messages.map((m) => m.content),
    [
      AVISO,
      "Quiero probarlo el martes",
      "El martes hay lugar. ¿A qué hora?",
      "de tarde",
      "Perfecto, a la tarde. ¿A qué hora te queda bien?",
    ],
  );
});

test("si el turno ya terminó, el número que llegó después se confirma en un turno de seguimiento, con tope", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  modelo = (request, opciones) => {
    const ultimo = JSON.stringify(request.messages.at(-1));
    const texto = ultimo.includes("096468788")
      ? "Tu teléfono es 096 468 788. ¿Es correcto?"
      : "Dale, decime el número.";
    opciones?.alEscribir?.(texto);
    return Promise.resolve({ text: texto, toolCalls: [] });
  };

  const primero = await leerStream(
    await pedir({ llamada, llamante, messages: hastaElTurno("Te paso mi teléfono") }),
  );
  assert.deepEqual(primero.textos, ["Dale, decime el número."]);
  await conversacionDe(llamada, 3);

  const conElNumero = await leerStream(
    await pedir({ llamada, llamante, messages: hastaElTurno("Te paso mi teléfono: 096468788") }),
  );
  assert.deepEqual(conElNumero.textos, [
    "Tu teléfono es cero noventa y seis, cuatro seis ocho, siete ocho ocho. ",
    "¿Es correcto?",
  ]);
  assert.equal(pedidos.length, 2);
  const conversacion = await conversacionDe(llamada, 5);
  assert.deepEqual(
    conversacion.messages.filter((m) => m.direction === "INBOUND").map((m) => m.content),
    ["Te paso mi teléfono", "096468788"],
  );

  // Un reintento de la misma frase se engancha: no corre otro turno.
  await leerStream(
    await pedir({ llamada, llamante, messages: hastaElTurno("Te paso mi teléfono: 096468788") }),
  );
  assert.equal(pedidos.length, 2);

  // Como mucho dos turnos de seguimiento por número de turno.
  await leerStream(
    await pedir({
      llamada,
      llamante,
      messages: hastaElTurno("Te paso mi teléfono: 096468788, gracias"),
    }),
  );
  assert.equal(pedidos.length, 3);
  await leerStream(
    await pedir({
      llamada,
      llamante,
      messages: hastaElTurno("Te paso mi teléfono: 096468788, gracias che"),
    }),
  );
  assert.equal(pedidos.length, 3);
});

async function hastaQue(condicion: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicion(); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(condicion(), true);
}

// Lo dicho hasta un turno, con el mismo comienzo de llamada.
function hastaElTurno(dicho: string) {
  return [
    { role: "system", content: "El prompt de la plataforma, que no se usa." },
    { role: "assistant", content: AVISO },
    { role: "user", content: dicho },
  ];
}

test("la frase más larga reemplaza al turno que no hizo nada, y el cancelado no deja rastro", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  modelo = async (request, opciones) => {
    if (!JSON.stringify(request.messages.at(-1)).includes("mail")) {
      // El turno de la frase a medias: cuando vuelve, ya lo cancelaron.
      await espera;
      opciones?.alEscribir?.("El martes hay lugar.");
      return { text: "El martes hay lugar.", toolCalls: [] };
    }
    opciones?.alEscribir?.("Anotado tu mail, ¿algo más?");
    return { text: "Anotado tu mail, ¿algo más?", toolCalls: [] };
  };

  const aMedias = await pedir({ llamada, llamante, messages: hastaElTurno("Sí,") });
  // El turno de la frase a medias ya está esperando al modelo.
  await hastaQue(() => pedidos.length === 1);
  const completa = await pedir({
    llamada,
    llamante,
    messages: hastaElTurno("Sí, y mi mail es persona arroba example punto com"),
  });
  soltar();
  const [uno, dos] = await Promise.all([leerStream(aMedias), leerStream(completa)]);

  // Los dos pedidos escuchan la respuesta a la frase entera.
  assert.deepEqual(uno.textos, ["Anotado tu mail, ¿algo más?"]);
  assert.deepEqual(dos.textos, ["Anotado tu mail, ¿algo más?"]);
  assert.equal(uno.cerro, true);
  assert.equal(pedidos.length, 2);
  // Del cancelado no queda nada: ni lo que dijo el cliente, ni una respuesta,
  // ni su uso del modelo.
  const conversacion = await conversacionDe(llamada, 3);
  assert.deepEqual(
    conversacion.messages.filter((m) => m.direction === "INBOUND").map((m) => m.content),
    ["Sí, y mi mail es persona arroba example punto com"],
  );
  assert.deepEqual(
    conversacion.messages.filter((m) => m.senderType === "AGENT").map((m) => m.content),
    [AVISO, "Anotado tu mail, ¿algo más?"],
  );
  assert.equal(await prisma.llmTurnUsage.count({ where: { conversationId: conversacion.id } }), 1);
});

test("si el turno ya corrió una herramienta, no se cancela: la frase más larga va en un turno de seguimiento", async () => {
  const llamada = randomUUID();
  const llamante = telefonoNuevo();
  let soltar: () => void = () => undefined;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  let llamadas = 0;
  modelo = async (_request, opciones) => {
    llamadas += 1;
    if (llamadas === 1) {
      return {
        text: null,
        toolCalls: [{ id: "c1", name: "get_payment_info", arguments: {} }],
      };
    }
    await espera;
    opciones?.alEscribir?.("Te paso los datos por mensaje.");
    return { text: "Te paso los datos por mensaje.", toolCalls: [] };
  };

  const aMedias = await pedir({ llamada, llamante, messages: hastaElTurno("¿Cómo pago") });
  // Hasta que el turno llega a la segunda llamada al modelo: ya corrió la herramienta.
  await hastaQue(() => llamadas === 2);
  const completa = await pedir({
    llamada,
    llamante,
    messages: hastaElTurno("¿Cómo pago la seña del auto?"),
  });
  soltar();
  const [uno, dos] = await Promise.all([leerStream(aMedias), leerStream(completa)]);

  // El primero terminó con su herramienta; el de seguimiento corrió después.
  assert.deepEqual(uno.textos, ["Te paso los datos por mensaje."]);
  assert.deepEqual(dos.textos, ["Te paso los datos por mensaje."]);
  assert.equal(pedidos.length, 3);
  const conversacion = await conversacionDe(llamada, 5);
  assert.deepEqual(
    conversacion.messages.filter((m) => m.direction === "INBOUND").map((m) => m.content),
    ["¿Cómo pago", "la seña del auto?"],
  );
});

test("una continuación sin turno que seguir pide repetir y no corre el modelo", async () => {
  const { textos, cerro } = await leerStream(
    await pedir({
      llamada: randomUUID(),
      llamante: telefonoNuevo(),
      messages: [
        { role: "assistant", content: AVISO },
        { role: "user", content: "Quiero reservar." },
        { role: "assistant", content: "Dale, ya" },
      ],
    }),
  );
  assert.deepEqual(textos, [FRASE_DE_PROBLEMA]);
  assert.equal(cerro, true);
  assert.equal(pedidos.length, 0);
});

test("si el modelo tarda, sale una frase de espera y no se guarda", async () => {
  const llamada = randomUUID();
  modelo = async (_request, opciones) => {
    await new Promise((r) => setTimeout(r, 1700));
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

// ---------------------------------------------------------------------------
// PR 7: transferir y colgar. La plataforma manda sus herramientas de sistema en
// `tools`; si el turno termina en una, va al final del stream como una llamada
// a herramienta y el cierre dice "tool_calls".
// ---------------------------------------------------------------------------

const TELEFONO_DE_LA_SUCURSAL = "+59899123456";

const TRANSFERIR = (numeros?: string[]) => ({
  type: "function",
  function: {
    name: "transfer_to_number",
    parameters: {
      type: "object",
      properties: {
        transfer_number: numeros ? { type: "string", enum: numeros } : { type: "string" },
        client_message: { type: "string" },
        agent_message: { type: "string" },
      },
    },
  },
});
const COLGAR = { type: "function", function: { name: "end_call", parameters: {} } };

interface StreamConHerramienta {
  textos: string[];
  herramienta: { name: string; arguments: Record<string, unknown> } | null;
  finishReason: string | null;
}

async function leerStreamConHerramienta(res: Response): Promise<StreamConHerramienta> {
  assert.equal(res.status, 200);
  const lineas = (await res.text()).split("\n\n").filter((l) => l.startsWith("data: "));
  assert.equal(lineas.at(-1), "data: [DONE]");
  const trozos = lineas.slice(0, -1).map(
    (l) =>
      JSON.parse(l.slice(6)) as {
        choices: {
          delta: {
            content?: string;
            tool_calls?: { function: { name: string; arguments: string } }[];
          };
          finish_reason: string | null;
        }[];
      },
  );
  const conHerramienta = trozos.filter((t) => t.choices[0].delta.tool_calls);
  assert.ok(conHerramienta.length <= 1, "como mucho una herramienta por turno");
  const llamada = conHerramienta[0]?.choices[0].delta.tool_calls?.[0];
  return {
    textos: trozos.map((t) => t.choices[0].delta.content ?? "").filter((t) => t.length > 0),
    herramienta: llamada
      ? {
          name: llamada.function.name,
          arguments: JSON.parse(llamada.function.arguments) as Record<string, unknown>,
        }
      : null,
    finishReason: trozos.at(-1)?.choices[0].finish_reason ?? null,
  };
}

// Un turno con las herramientas de la plataforma, esperando a que se guarde
// (el turno sigue guardando después de cerrar el stream).
async function turnoConHerramientas(tools?: unknown[]): Promise<StreamConHerramienta> {
  const llamada = randomUUID();
  const stream = await leerStreamConHerramienta(
    await pedir({ llamada, llamante: telefonoNuevo(), ...(tools ? { tools } : {}) }),
  );
  await conversacionDe(llamada, 3);
  return stream;
}

const pideDerivar: Modelo = () =>
  Promise.resolve({
    text: null,
    toolCalls: [
      {
        id: "c1",
        name: "request_human_handoff",
        arguments: {
          reason: "Pidió una persona",
          mensajeAlCliente: "Te paso con alguien del equipo.",
        },
      },
    ],
  });

async function conTelefonoDeTransferencia(fn: () => Promise<void>): Promise<void> {
  await prisma.branch.update({
    where: { id: branchId },
    data: { transferPhone: TELEFONO_DE_LA_SUCURSAL },
  });
  try {
    await fn();
  } finally {
    await prisma.branch.update({ where: { id: branchId }, data: { transferPhone: null } });
    await prisma.branchBusinessHours.deleteMany({ where: { branchId } });
  }
}

test("derivar con la sucursal abierta: transfiere al número de la sucursal y la derivación queda igual", async () => {
  await conTelefonoDeTransferencia(async () => {
    const llamada = randomUUID();
    modelo = pideDerivar;
    const stream = await leerStreamConHerramienta(
      await pedir({ llamada, llamante: telefonoNuevo(), tools: [COLGAR, TRANSFERIR()] }),
    );

    assert.deepEqual(stream.textos, ["Te paso con alguien del equipo."]);
    assert.equal(stream.herramienta?.name, "transfer_to_number");
    assert.equal(stream.herramienta?.arguments.transfer_number, TELEFONO_DE_LA_SUCURSAL);
    assert.equal(stream.finishReason, "tool_calls");
    // El modelo sabe que la llamada pasa a una persona.
    assert.match(pedidos[0].request.systemPrompt, /la llamada pasa en ese momento a una persona/);
    const conversacion = await conversacionDe(llamada, 3);
    assert.equal(conversacion.status, "TRANSFERRED_TO_HUMAN");
  });
});

test("el número de la lista de la plataforma se manda tal cual lo tiene cargado", async () => {
  await conTelefonoDeTransferencia(async () => {
    modelo = pideDerivar;
    const stream = await turnoConHerramientas([TRANSFERIR(["+598 99 123 456"])]);
    assert.equal(stream.herramienta?.arguments.transfer_number, "+598 99 123 456");
  });
});

// El día de hoy en la zona de la sucursal, para cargar un horario que no lo incluya.
function diaDeHoyEnMontevideo(): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Montevideo" })
    .format(new Date())
    .toUpperCase();
}

test("sin transferencia: fuera de horario, número no cargado en la plataforma o plataforma sin la herramienta", async () => {
  await conTelefonoDeTransferencia(async () => {
    modelo = pideDerivar;
    const sinTransferir = async (tools: unknown[]) => {
      const stream = await turnoConHerramientas(tools);
      assert.equal(stream.herramienta, null);
      assert.equal(stream.finishReason, "stop");
      // La derivación ocurre igual.
      assert.deepEqual(stream.textos, ["Te paso con alguien del equipo."]);
    };

    await sinTransferir([TRANSFERIR(["+59899000000"])]);
    await sinTransferir([COLGAR]);
    // Sin la herramienta de la plataforma, el prompt no promete la transferencia.
    assert.doesNotMatch(pedidos.at(-1)!.request.systemPrompt, /la llamada pasa en ese momento/);

    // Cerrada: un horario solo para otro día de la semana.
    const otroDia = diaDeHoyEnMontevideo() === "MONDAY" ? "TUESDAY" : "MONDAY";
    await prisma.branchBusinessHours.create({
      data: {
        organizationId: orgId,
        branchId,
        weekday: otroDia,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      },
    });
    await sinTransferir([TRANSFERIR()]);
  });
});

test("colgar: con la despedida la llamada se corta; con una pregunta, no", async () => {
  const pideColgar =
    (texto: string): Modelo =>
    (_request, opciones) => {
      opciones?.alEscribir?.(texto);
      return Promise.resolve({
        text: texto,
        toolCalls: [{ id: "c1", name: "end_call", arguments: {} }],
      });
    };

  modelo = pideColgar("Gracias por llamar, que tengas un buen día.");
  const despedida = await turnoConHerramientas([COLGAR]);
  assert.deepEqual(despedida.textos, ["Gracias por llamar, que tengas un buen día."]);
  assert.equal(despedida.herramienta?.name, "end_call");
  assert.equal(despedida.finishReason, "tool_calls");
  // Se le ofreció al modelo, y no se le volvió a preguntar después de pedirlo.
  assert.equal(pedidos.length, 1);
  assert.ok((pedidos[0].request.tools ?? []).some((t) => t.name === "end_call"));

  pedidos = [];
  modelo = pideColgar("Listo. ¿Te ayudo con algo más?");
  const pregunta = await turnoConHerramientas([COLGAR]);
  assert.equal(pregunta.herramienta, null);
  assert.equal(pregunta.finishReason, "stop");
});

test("sin la herramienta de colgar de la plataforma, al modelo no se le ofrece", async () => {
  await turnoConHerramientas();
  assert.equal(
    (pedidos[0].request.tools ?? []).some((t) => t.name === "end_call"),
    false,
  );
});
