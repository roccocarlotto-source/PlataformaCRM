import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type ConversationChannel } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import type { RespuestaDesdeMeta } from "./conversationReply.service";
import type { RegistrarEntranteInput } from "./agentOrchestration.service";
import type { CompletarNombreInput } from "./metaContact.service";
import {
  leerEco,
  canalDelObjeto,
  hayQueReintentarElLote,
  leerMensaje,
  procesarWebhookDeMeta,
  type DepsDelWebhookMeta,
  type MetaWebhookPayload,
} from "./metaWebhook.service";

// ---------------------------------------------------------------------------
// metaWebhook.service.ts (ítem 171), SIN BASE: las dependencias se inyectan
// con dobles que registran lo que se les pidió. Lo que se verifica es la
// DECISIÓN — qué se ignora, qué se deduplica, cómo se llega al agente por
// Messenger y por Instagram, y con qué campos queda el job. Que Postgres lo
// guarde de verdad lo cubre metaWebhook.controller.integration-test.ts.
// ---------------------------------------------------------------------------

const PAGE_ID = "1111";
const IGID = "17841400000000000";
const ORG = "org-1";
const APP_DEL_CRM = "111222333";
// La app de la bandeja de Meta (cualquier id que no sea el del CRM).
const APP_DE_LA_BANDEJA = 263902037430900;
const CLIENTE_CONOCIDO = "psid-conocido";

interface Estado {
  consultasDeInstagram: string[];
  consultasDeAgente: string[];
  contactos: { organizationId: string; channel: string; externalId: string }[];
  entrantes: RegistrarEntranteInput[];
  jobs: Record<string, unknown>[];
  // Las conversaciones que se dejaron para una persona (OPUS-I-01).
  derivadas: string[];
  // Las respuestas desde la bandeja de Meta que se mandaron a registrar
  // (OPUS-B-01).
  ecos: RespuestaDesdeMeta[];
  // Los contactos para los que se pidió el nombre del perfil a Meta.
  nombresPedidos: CompletarNombreInput[];
}

type Agente = Awaited<ReturnType<DepsDelWebhookMeta["findAgentByFacebookPageId"]>>;

function dobles(
  opciones: {
    agente?: Agente;
    paginaDeInstagram?: { pageId: string; organizationId: string } | null;
    // La conexión vigente de la página de Messenger (D-11 / A-08). Por defecto,
    // conectada en ORG.
    conexionDeLaPagina?: { pageId: string; organizationId: string } | null;
    yaProcesados?: string[];
    // El rubro contesta aunque el agente no atienda (una clínica).
    respondeSinAgente?: boolean;
    falloAlRegistrar?: (mid: string) => unknown;
    // El registro reconoce el texto como de un saliente del CRM.
    ecoEsPropio?: boolean;
    // El contacto ya existía (por defecto, se crea con este mensaje).
    contactoYaExistia?: boolean;
    // Lo que hace el pedido del nombre del perfil. Por defecto, resuelve.
    completarNombre?: () => Promise<unknown>;
  } = {},
): { deps: DepsDelWebhookMeta; estado: Estado } {
  const estado: Estado = {
    consultasDeInstagram: [],
    consultasDeAgente: [],
    contactos: [],
    entrantes: [],
    jobs: [],
    derivadas: [],
    ecos: [],
    nombresPedidos: [],
  };
  const agente: Agente =
    "agente" in opciones
      ? (opciones.agente ?? null)
      : {
          id: "agente-1",
          organizationId: ORG,
          branchId: "sucursal-1",
          isActive: true,
          channels: ["MESSENGER", "INSTAGRAM"],
        };
  const procesados = new Set(opciones.yaProcesados ?? []);

  const deps: DepsDelWebhookMeta = {
    findPageIdByInstagramBusinessAccountId: async (igid) => {
      estado.consultasDeInstagram.push(igid);
      return "paginaDeInstagram" in opciones
        ? (opciones.paginaDeInstagram ?? null)
        : { pageId: PAGE_ID, organizationId: ORG };
    },
    findActiveMetaConnectionByPageId: async (pageId) => {
      if ("conexionDeLaPagina" in opciones) return opciones.conexionDeLaPagina ?? null;
      return pageId === PAGE_ID ? { pageId, organizationId: ORG } : null;
    },
    findAgentByFacebookPageId: async (pageId) => {
      estado.consultasDeAgente.push(pageId);
      return pageId === PAGE_ID ? agente : null;
    },
    findMessageByExternalId: async (_org, mid) =>
      procesados.has(mid) ? { id: "m", conversationId: `conv-${mid}` } : null,
    resolveMetaContact: async (organizationId, channel, externalId) => {
      estado.contactos.push({ organizationId, channel, externalId });
      return { contactId: "contacto-1", creado: !opciones.contactoYaExistia };
    },
    completarNombreDelContacto: (entrada) => {
      estado.nombresPedidos.push(entrada);
      return opciones.completarNombre ? opciones.completarNombre() : Promise.resolve("completado");
    },
    registrarEntrante: async (input, { enLaMismaTransaccion }) => {
      const fallo = opciones.falloAlRegistrar?.(input.externalMessageId ?? "");
      if (fallo) throw fallo;
      estado.entrantes.push(input);
      await enLaMismaTransaccion?.({} as Db, { id: `entrante-${input.externalMessageId}` });
      return { conversation: { id: `conv-${input.externalMessageId}` } };
    },
    createAgentInboundJob: async (data) => {
      estado.jobs.push({ ...data });
      return {};
    },
    derivarEntranteSinAgente: async ({ conversationId }) => {
      estado.derivadas.push(conversationId);
    },
    // Una automotora: sin agente, no contesta (docs/rubros.md §5.3).
    respondeSinAgente: async () => opciones.respondeSinAgente ?? false,
    appId: () => APP_DEL_CRM,
    // Un cliente conocido: el que ya le escribió al negocio.
    findContactIdByExternalIdentity: async ({ externalId }) =>
      externalId === CLIENTE_CONOCIDO ? "contacto-1" : null,
    registrarRespuestaDesdeLaBandejaDeMeta: async (input) => {
      estado.ecos.push(input);
      return opciones.ecoEsPropio ? "propia" : "registrada";
    },
  };
  return { deps, estado };
}

function evento(
  opts: {
    mid?: string;
    sender?: string;
    text?: string;
    isEcho?: boolean;
    adjunto?: boolean;
    // En un eco: la app que mandó el mensaje y el cliente al que le llegó.
    appId?: number | string;
    cliente?: string;
  } = {},
) {
  const message: Record<string, unknown> = { mid: opts.mid ?? "m_1" };
  if (opts.text !== undefined) message.text = opts.text;
  if (opts.isEcho) message.is_echo = true;
  if (opts.appId !== undefined) message.app_id = opts.appId;
  if (opts.isEcho) {
    // En un eco los roles se invierten: escribe la página, recibe el cliente.
    return {
      sender: { id: PAGE_ID },
      recipient: { id: opts.cliente ?? CLIENTE_CONOCIDO },
      timestamp: 1700000000000,
      message,
    };
  }
  if (opts.adjunto) {
    message.attachments = [{ type: "image", payload: { url: "https://ejemplo.test/x.jpg" } }];
  }
  return {
    sender: { id: opts.sender ?? "psid-123456789" },
    recipient: { id: PAGE_ID },
    timestamp: 1700000000000,
    message,
  };
}

function lote(object: string, cuentaId: string, eventos: unknown[]): MetaWebhookPayload {
  return { object, entry: [{ id: cuentaId, messaging: eventos }] };
}

// --- leerMensaje / canalDelObjeto --------------------------------------------

test("canalDelObjeto: page es Messenger, instagram es Instagram, cualquier otro no es de este webhook", () => {
  assert.equal(canalDelObjeto("page"), "MESSENGER");
  assert.equal(canalDelObjeto("instagram"), "INSTAGRAM");
  assert.equal(canalDelObjeto("whatsapp_business_account"), null);
  assert.equal(canalDelObjeto("user"), null);
});

test("leerMensaje: un texto se lee con mid, remitente y el texto recortado", () => {
  assert.deepEqual(leerMensaje(evento({ mid: "m_9", sender: "psid-9", text: "  Hola  " })), {
    mid: "m_9",
    senderId: "psid-9",
    texto: "Hola",
  });
});

test("leerMensaje: un echo (el negocio escribiendo) se ignora aunque traiga texto", () => {
  assert.equal(leerMensaje(evento({ text: "Gracias por escribir", isEcho: true })), null);
});

test("leerMensaje: solo adjunto, texto vacío, postback, lectura o basura -> null sin error", () => {
  assert.equal(leerMensaje(evento({ adjunto: true })), null);
  assert.equal(leerMensaje(evento({ text: "   " })), null);
  assert.equal(
    leerMensaje({ sender: { id: "p" }, recipient: { id: PAGE_ID }, postback: { payload: "X" } }),
    null,
  );
  assert.equal(leerMensaje({ sender: { id: "p" }, read: { watermark: 1 } }), null);
  assert.equal(leerMensaje(null), null);
  assert.equal(leerMensaje("hola"), null);
});

test("leerMensaje: un adjunto CON texto se procesa como texto (el adjunto no se usa)", () => {
  assert.equal(leerMensaje(evento({ text: "Mirá esto", adjunto: true }))?.texto, "Mirá esto");
});

// --- procesarWebhookDeMeta ---------------------------------------------------

test("Messenger: el mensaje se encola con canal MESSENGER, el Page ID como cuenta y el PSID como usuario", async () => {
  const { deps, estado } = dobles();
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", sender: "psid-1", text: "Hola" })]),
    deps,
  );

  assert.deepEqual(resumen, {
    encolado: 1,
    derivado: 0,
    eco: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 0,
    descartado: 0,
  });
  assert.deepEqual(estado.consultasDeInstagram, [], "Messenger no pasa por la conexión");
  assert.deepEqual(estado.consultasDeAgente, [PAGE_ID]);
  assert.deepEqual(estado.contactos, [
    { organizationId: ORG, channel: "MESSENGER", externalId: "psid-1" },
  ]);
  assert.equal(estado.entrantes.length, 1);
  assert.equal(estado.entrantes[0].channel, "MESSENGER");
  assert.equal(estado.entrantes[0].texto, "Hola");
  assert.equal(estado.entrantes[0].externalMessageId, "m_1");
  assert.equal(estado.entrantes[0].externalThreadId, "psid-1");
  assert.equal(estado.entrantes[0].contactId, "contacto-1");
  assert.deepEqual(estado.jobs, [
    {
      organizationId: ORG,
      messageId: "entrante-m_1",
      channel: "MESSENGER",
      channelAccountId: PAGE_ID,
      externalUserId: "psid-1",
    },
  ]);
});

test("Instagram: la página sale de la conexión por el IGID, y el job lleva el PAGE ID, no el IGID", async () => {
  const { deps, estado } = dobles();
  const resumen = await procesarWebhookDeMeta(
    lote("instagram", IGID, [evento({ mid: "ig_1", sender: "igsid-1", text: "Hola" })]),
    deps,
  );

  assert.equal(resumen.encolado, 1);
  assert.deepEqual(estado.consultasDeInstagram, [IGID]);
  assert.deepEqual(estado.consultasDeAgente, [PAGE_ID]);
  assert.deepEqual(estado.contactos, [
    { organizationId: ORG, channel: "INSTAGRAM", externalId: "igsid-1" },
  ]);
  assert.equal(estado.jobs[0].channel, "INSTAGRAM");
  assert.equal(estado.jobs[0].channelAccountId, PAGE_ID);
  assert.equal(estado.jobs[0].externalUserId, "igsid-1");
});

test("Instagram sin página conectada para ese IGID: ignorado, sin buscar agente", async () => {
  const { deps, estado } = dobles({ paginaDeInstagram: null });
  const resumen = await procesarWebhookDeMeta(
    lote("instagram", IGID, [evento({ text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.ignorado, 1);
  assert.deepEqual(estado.consultasDeAgente, []);
  assert.equal(estado.jobs.length, 0);
});

test("echo y mensaje sin texto: ignorados sin tocar agente, contacto ni cola", async () => {
  const { deps, estado } = dobles();
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [
      // El eco de algo que mandó este CRM: trae el app_id de esta app.
      evento({ text: "respuesta", isEcho: true, appId: APP_DEL_CRM }),
      evento({ adjunto: true }),
    ]),
    deps,
  );
  assert.deepEqual(resumen, {
    encolado: 0,
    derivado: 0,
    eco: 0,
    duplicado: 0,
    ignorado: 2,
    fallido: 0,
    descartado: 0,
  });
  assert.deepEqual(estado.consultasDeAgente, []);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.jobs.length, 0);
});

test("dedup: un mid ya procesado es duplicado sin resolver contacto ni encolar", async () => {
  const { deps, estado } = dobles({ yaProcesados: ["m_1"] });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.duplicado, 1);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.jobs.length, 0);
});

test("dedup: dos entregas en paralelo — el P2002 al registrar, confirmado releyendo, es duplicado", async () => {
  let yaEsta = false;
  const { deps } = dobles({
    falloAlRegistrar: () => {
      yaEsta = true;
      return new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      });
    },
  });
  deps.findMessageByExternalId = async () =>
    yaEsta ? { id: "m", conversationId: "conv-m" } : null;
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.duplicado, 1);
});

test("página sin agente: ignorado sin crear contacto (no hay conversación donde guardarlo)", async () => {
  const { deps, estado } = dobles({ agente: null });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.ignorado, 1);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.entrantes.length, 0);
});

// OPUS-I-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): antes estos
// tres casos descartaban el mensaje sin crear ni el contacto.
test("OPUS-I-01: agente apagado o sin el canal -> el entrante se guarda SIN job y la conversación queda para una persona", async () => {
  const base = {
    id: "agente-1",
    organizationId: ORG,
    branchId: "sucursal-1",
    isActive: true,
    channels: ["MESSENGER"] as ConversationChannel[],
  };
  const casos: { nombre: string; agente: Agente; object: string; cuenta: string }[] = [
    {
      nombre: "inactivo",
      agente: { ...base, isActive: false },
      object: "page",
      cuenta: PAGE_ID,
    },
    {
      nombre: "sin MESSENGER",
      agente: { ...base, channels: ["WEB"] },
      object: "page",
      cuenta: PAGE_ID,
    },
    // Tiene Messenger pero no Instagram: el de Instagram queda para una persona.
    { nombre: "sin INSTAGRAM", agente: base, object: "instagram", cuenta: IGID },
  ];
  for (const caso of casos) {
    const { deps, estado } = dobles({ agente: caso.agente });
    const resumen = await procesarWebhookDeMeta(
      lote(caso.object, caso.cuenta, [evento({ mid: "m_1", text: "Hola" })]),
      deps,
    );
    assert.equal(resumen.derivado, 1, caso.nombre);
    assert.equal(resumen.ignorado, 0, caso.nombre);
    assert.equal(estado.contactos.length, 1, caso.nombre);
    assert.equal(estado.entrantes.length, 1, caso.nombre);
    assert.equal(estado.entrantes[0]?.texto, "Hola", caso.nombre);
    assert.equal(estado.jobs.length, 0, caso.nombre);
    assert.deepEqual(estado.derivadas, ["conv-m_1"], caso.nombre);
  }
});

test("rubros §5.3: con el agente apagado, si el rubro contesta igual (clínica), el entrante se encola y no se deriva desde el webhook", async () => {
  const { deps, estado } = dobles({
    agente: {
      id: "agente-1",
      organizationId: ORG,
      branchId: "sucursal-1",
      isActive: false,
      channels: ["MESSENGER"],
    },
    respondeSinAgente: true,
  });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", text: "no puedo respirar" })]),
    deps,
  );
  // El worker decide: la urgencia la contesta él (derivarEntranteSinAgente
  // con responder); cualquier otra cosa la deriva como siempre.
  assert.equal(resumen.encolado, 1);
  assert.equal(resumen.derivado, 0);
  assert.equal(estado.jobs.length, 1);
  assert.deepEqual(estado.derivadas, []);
});

test("OPUS-I-01: la reentrega de un entrante de un agente apagado es duplicado y vuelve a pedir la derivación (por si la primera se cortó antes)", async () => {
  const { deps, estado } = dobles({
    agente: {
      id: "agente-1",
      organizationId: ORG,
      branchId: "sucursal-1",
      isActive: false,
      channels: ["MESSENGER"],
    },
    yaProcesados: ["m_1"],
  });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.duplicado, 1);
  assert.equal(estado.entrantes.length, 0);
  assert.deepEqual(estado.derivadas, ["conv-m_1"]);
});

test("con el agente atendiendo, un duplicado no deriva nada", async () => {
  const { deps, estado } = dobles({ yaProcesados: ["m_1"] });
  await procesarWebhookDeMeta(lote("page", PAGE_ID, [evento({ mid: "m_1", text: "Hola" })]), deps);
  assert.deepEqual(estado.derivadas, []);
});

test("un mensaje que falla no tumba el lote: el siguiente se encola igual", async () => {
  const { deps, estado } = dobles({
    falloAlRegistrar: (mid) => (mid === "m_malo" ? new Error("se cayó la base") : undefined),
  });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [
      evento({ mid: "m_malo", text: "uno" }),
      evento({ mid: "m_bueno", text: "dos" }),
    ]),
    deps,
  );
  assert.deepEqual(resumen, {
    encolado: 1,
    derivado: 0,
    eco: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 1,
    descartado: 0,
  });
  assert.deepEqual(
    estado.jobs.map((j) => j.messageId),
    ["entrante-m_bueno"],
  );
  // FABLE-C-01 (docs-privados/auditoria-2026-10-05-FABLE.md, local): ese
  // "fallido" es lo que hace que el webhook le pida a Meta que reintente.
  assert.equal(hayQueReintentarElLote(resumen), true);
});

test("FABLE-C-01: la reentrega del lote después de un fallo guarda el que faltaba y no repite el que ya estaba", async () => {
  let baseCaida = true;
  const guardados = new Set<string>();
  const { deps, estado } = dobles({
    falloAlRegistrar: (mid) =>
      baseCaida && mid === "m_2" ? new Error("se cayó la base") : undefined,
  });
  const registrar = deps.registrarEntrante;
  deps.registrarEntrante = async (input, opciones) => {
    const r = await registrar(input, opciones);
    guardados.add(input.externalMessageId ?? "");
    return r;
  };
  deps.findMessageByExternalId = async (_org, mid) =>
    guardados.has(mid) ? { id: mid, conversationId: `conv-${mid}` } : null;
  const elLote = lote("page", PAGE_ID, [
    evento({ mid: "m_1", text: "uno" }),
    evento({ mid: "m_2", text: "dos" }),
  ]);

  const primera = await procesarWebhookDeMeta(elLote, deps);
  assert.equal(primera.encolado, 1);
  assert.equal(primera.fallido, 1);
  assert.equal(hayQueReintentarElLote(primera), true);

  baseCaida = false;
  const segunda = await procesarWebhookDeMeta(elLote, deps);
  assert.equal(segunda.duplicado, 1);
  assert.equal(segunda.encolado, 1);
  assert.equal(hayQueReintentarElLote(segunda), false);
  assert.deepEqual(
    estado.jobs.map((j) => j.messageId),
    ["entrante-m_1", "entrante-m_2"],
  );
});

test("FABLE-C-01: un rechazo de negocio (AppError 4xx) se descarta sin pedir reintento; un 5xx sí lo pide", async () => {
  const con = async (fallo: unknown) => {
    const { deps } = dobles({ falloAlRegistrar: () => fallo });
    return procesarWebhookDeMeta(lote("page", PAGE_ID, [evento({ text: "Hola" })]), deps);
  };

  const rechazo = await con(new AppError("El contacto no existe", 400));
  assert.equal(rechazo.descartado, 1);
  assert.equal(rechazo.fallido, 0);
  assert.equal(hayQueReintentarElLote(rechazo), false);

  const caida = await con(new AppError("La base no respondió", 503));
  assert.equal(caida.fallido, 1);
  assert.equal(hayQueReintentarElLote(caida), true);
});

test("otro objeto (whatsapp_business_account) o entry sin id / sin messaging: nada que hacer", async () => {
  const { deps, estado } = dobles();
  const vacio = {
    encolado: 0,
    derivado: 0,
    eco: 0,
    duplicado: 0,
    ignorado: 0,
    fallido: 0,
    descartado: 0,
  };
  assert.deepEqual(
    await procesarWebhookDeMeta(
      lote("whatsapp_business_account", PAGE_ID, [evento({ text: "x" })]),
      deps,
    ),
    vacio,
  );
  assert.deepEqual(
    await procesarWebhookDeMeta(
      { object: "page", entry: [{ messaging: [evento({ text: "x" })] }, { id: PAGE_ID }] },
      deps,
    ),
    vacio,
  );
  assert.deepEqual(estado.consultasDeAgente, []);
});

// ---------------------------------------------------------------------------
// D-11 y A-08 de docs-privados/auditoria-2026-09-30-corta.md (local): la
// página tiene que tener una conexión vigente, y en la MISMA organización que
// el agente que la tiene asignada.
// ---------------------------------------------------------------------------

test("D-11: Messenger de una página sin conexión vigente (desconectada) → ignorado, sin buscar agente ni crear nada", async () => {
  const { deps, estado } = dobles({ conexionDeLaPagina: null });

  const resumen = await procesarWebhookDeMeta(lote("page", PAGE_ID, [evento()]), deps);

  assert.equal(resumen.ignorado, 1);
  assert.equal(estado.consultasDeAgente.length, 0);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.jobs.length, 0);
});

test("A-08: Messenger de una página conectada en OTRA organización que la del agente → ignorado, sin crear contacto", async () => {
  const { deps, estado } = dobles({
    conexionDeLaPagina: { pageId: PAGE_ID, organizationId: "otra-org" },
  });

  const resumen = await procesarWebhookDeMeta(lote("page", PAGE_ID, [evento()]), deps);

  assert.equal(resumen.ignorado, 1);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.entrantes.length, 0);
});

test("A-08: Instagram cuya conexión es de OTRA organización que la del agente de la página → ignorado", async () => {
  const { deps, estado } = dobles({
    paginaDeInstagram: { pageId: PAGE_ID, organizationId: "otra-org" },
  });

  const resumen = await procesarWebhookDeMeta(lote("instagram", IGID, [evento()]), deps);

  assert.equal(resumen.ignorado, 1);
  assert.equal(estado.contactos.length, 0);
  assert.equal(estado.jobs.length, 0);
});

// ---------------------------------------------------------------------------
// OPUS-B-01 (docs-privados/auditoria-2026-10-04-OPUS.md, local): los ecos. Lo
// que una persona responde desde la bandeja de Meta se registra; lo que mandó
// este CRM, no.
// ---------------------------------------------------------------------------

test("leerEco: un eco de texto se lee con el cliente como destinatario y la app que lo mandó", () => {
  assert.deepEqual(
    leerEco(
      evento({ mid: "m_e", text: " Hola, soy Laura ", isEcho: true, appId: 263902037430900 }),
    ),
    {
      mid: "m_e",
      recipientId: CLIENTE_CONOCIDO,
      texto: "Hola, soy Laura",
      appId: "263902037430900",
    },
  );
  // Sin app_id (Instagram no siempre lo manda).
  assert.equal(leerEco(evento({ text: "Hola", isEcho: true }))?.appId, null);
  // Un entrante no es un eco, y un eco sin texto no se procesa.
  assert.equal(leerEco(evento({ text: "Hola" })), null);
  assert.equal(leerEco(evento({ isEcho: true, adjunto: true })), null);
});

test("OPUS-B-01: el eco de una respuesta escrita en la bandeja de Meta se manda a registrar como respuesta humana, sin encolar ningún turno", async () => {
  for (const [object, cuenta, channel] of [
    ["page", PAGE_ID, "MESSENGER"],
    ["instagram", IGID, "INSTAGRAM"],
  ] as const) {
    const { deps, estado } = dobles();
    const resumen = await procesarWebhookDeMeta(
      lote(object, cuenta, [
        evento({ mid: "m_eco", text: "Hola, soy Laura", isEcho: true, appId: APP_DE_LA_BANDEJA }),
      ]),
      deps,
    );

    assert.equal(resumen.eco, 1, channel);
    assert.deepEqual(estado.ecos, [
      {
        organizationId: ORG,
        agentId: "agente-1",
        branchId: "sucursal-1",
        contactId: "contacto-1",
        channel,
        externalThreadId: CLIENTE_CONOCIDO,
        externalMessageId: "m_eco",
        texto: "Hola, soy Laura",
      },
    ]);
    assert.equal(estado.jobs.length, 0, "un eco nunca es un entrante");
    assert.equal(estado.entrantes.length, 0);
    assert.equal(estado.contactos.length, 0, "ni crea contactos");
  }
});

test("OPUS-B-01: el eco de lo que mandó este CRM (su app_id) se ignora sin tocar nada", async () => {
  const { deps, estado } = dobles();
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [
      evento({ text: "¡Hola! ¿En qué te ayudo?", isEcho: true, appId: Number(APP_DEL_CRM) }),
    ]),
    deps,
  );
  assert.equal(resumen.ignorado, 1);
  assert.equal(estado.ecos.length, 0);
  assert.equal(estado.consultasDeAgente.length, 0);
});

test("OPUS-B-01: sin app_id decide el texto — si el registro lo reconoce como propio, cuenta como ignorado", async () => {
  const { deps, estado } = dobles({ ecoEsPropio: true });
  const resumen = await procesarWebhookDeMeta(
    lote("instagram", IGID, [evento({ text: "¡Hola! ¿En qué te ayudo?", isEcho: true })]),
    deps,
  );
  assert.equal(resumen.ignorado, 1);
  assert.equal(resumen.eco, 0);
  assert.equal(estado.ecos.length, 1, "llegó a compararse");
});

test("OPUS-B-01: un eco hacia alguien que no es un contacto, repetido, o de una página sin agente no registra nada", async () => {
  const eco = (extra: Parameters<typeof evento>[0] = {}) =>
    evento({ mid: "m_eco", text: "Hola", isEcho: true, appId: APP_DE_LA_BANDEJA, ...extra });

  const desconocido = dobles();
  const r1 = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [eco({ cliente: "psid-desconocido" })]),
    desconocido.deps,
  );
  assert.equal(r1.ignorado, 1);
  assert.equal(desconocido.estado.ecos.length, 0);

  const repetido = dobles({ yaProcesados: ["m_eco"] });
  const r2 = await procesarWebhookDeMeta(lote("page", PAGE_ID, [eco()]), repetido.deps);
  assert.equal(r2.duplicado, 1);
  assert.equal(repetido.estado.ecos.length, 0);

  const sinAgente = dobles({ agente: null });
  const r3 = await procesarWebhookDeMeta(lote("page", PAGE_ID, [eco()]), sinAgente.deps);
  assert.equal(r3.ignorado, 1);
  assert.equal(sinAgente.estado.ecos.length, 0);
});

test("OPUS-B-01: con el agente apagado la respuesta de la persona se registra igual", async () => {
  const { deps, estado } = dobles({
    agente: {
      id: "agente-1",
      organizationId: ORG,
      branchId: "sucursal-1",
      isActive: false,
      channels: ["MESSENGER"],
    },
  });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [
      evento({ text: "Hola, soy Laura", isEcho: true, appId: APP_DE_LA_BANDEJA }),
    ]),
    deps,
  );
  assert.equal(resumen.eco, 1);
  assert.equal(estado.ecos.length, 1);
});

// --- El nombre del perfil del contacto nuevo ---------------------------------

test("contacto nuevo: se pide el nombre del perfil con el PAGE ID de la conexión (también en Instagram)", async () => {
  const messenger = dobles();
  await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", sender: "psid-1", text: "Hola" })]),
    messenger.deps,
  );
  assert.deepEqual(messenger.estado.nombresPedidos, [
    {
      organizationId: ORG,
      channel: "MESSENGER",
      pageId: PAGE_ID,
      externalId: "psid-1",
      contactId: "contacto-1",
    },
  ]);

  const instagram = dobles();
  await procesarWebhookDeMeta(
    lote("instagram", IGID, [evento({ mid: "m_2", sender: "igsid-1", text: "Hola" })]),
    instagram.deps,
  );
  assert.deepEqual(instagram.estado.nombresPedidos, [
    {
      organizationId: ORG,
      channel: "INSTAGRAM",
      pageId: PAGE_ID,
      externalId: "igsid-1",
      contactId: "contacto-1",
    },
  ]);
});

test("contacto que ya existía: no se le vuelve a pedir el nombre a Meta", async () => {
  const { deps, estado } = dobles({ contactoYaExistia: true });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", sender: "psid-1", text: "Hola de nuevo" })]),
    deps,
  );
  assert.equal(resumen.encolado, 1);
  assert.deepEqual(estado.nombresPedidos, []);
});

test("el nombre del perfil NUNCA frena el mensaje: si Meta falla o no contesta, se encola igual", async () => {
  // Falla: el mensaje se guarda y se encola como si nada.
  const falla = dobles({ completarNombre: () => Promise.reject(new Error("Meta no responde")) });
  const resumenConFallo = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", sender: "psid-1", text: "Hola" })]),
    falla.deps,
  );
  assert.equal(resumenConFallo.encolado, 1);
  assert.equal(resumenConFallo.fallido, 0);
  assert.equal(falla.estado.entrantes.length, 1);
  assert.equal(falla.estado.jobs.length, 1);

  // No contesta nunca: el webhook no lo espera.
  const cuelga = dobles({ completarNombre: () => new Promise(() => undefined) });
  const resumenSinRespuesta = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_2", sender: "psid-2", text: "Hola" })]),
    cuelga.deps,
  );
  assert.equal(resumenSinRespuesta.encolado, 1);
  assert.equal(cuelga.estado.nombresPedidos.length, 1);
});

test("con el agente apagado el contacto nuevo también pide su nombre (lo va a atender una persona)", async () => {
  const { deps, estado } = dobles({
    agente: {
      id: "agente-1",
      organizationId: ORG,
      branchId: "sucursal-1",
      isActive: false,
      channels: ["MESSENGER", "INSTAGRAM"],
    },
  });
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ mid: "m_1", sender: "psid-1", text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.derivado, 1);
  assert.equal(estado.nombresPedidos.length, 1);
});
