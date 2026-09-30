import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type ConversationChannel } from "@prisma/client";
import type { Db } from "../lib/prisma";
import type { RegistrarEntranteInput } from "./agentOrchestration.service";
import {
  canalDelObjeto,
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

interface Estado {
  consultasDeInstagram: string[];
  consultasDeAgente: string[];
  contactos: { organizationId: string; channel: string; externalId: string }[];
  entrantes: RegistrarEntranteInput[];
  jobs: Record<string, unknown>[];
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
    falloAlRegistrar?: (mid: string) => unknown;
  } = {},
): { deps: DepsDelWebhookMeta; estado: Estado } {
  const estado: Estado = {
    consultasDeInstagram: [],
    consultasDeAgente: [],
    contactos: [],
    entrantes: [],
    jobs: [],
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
    findMessageByExternalId: async (_org, mid) => (procesados.has(mid) ? { id: "m" } : null),
    resolveMetaContact: async (organizationId, channel, externalId) => {
      estado.contactos.push({ organizationId, channel, externalId });
      return "contacto-1";
    },
    registrarEntrante: async (input, { enLaMismaTransaccion }) => {
      const fallo = opciones.falloAlRegistrar?.(input.externalMessageId ?? "");
      if (fallo) throw fallo;
      estado.entrantes.push(input);
      await enLaMismaTransaccion({} as Db, { id: `entrante-${input.externalMessageId}` });
      return {};
    },
    createAgentInboundJob: async (data) => {
      estado.jobs.push({ ...data });
      return {};
    },
  };
  return { deps, estado };
}

function evento(
  opts: { mid?: string; sender?: string; text?: string; isEcho?: boolean; adjunto?: boolean } = {},
) {
  const message: Record<string, unknown> = { mid: opts.mid ?? "m_1" };
  if (opts.text !== undefined) message.text = opts.text;
  if (opts.isEcho) message.is_echo = true;
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

  assert.deepEqual(resumen, { encolado: 1, duplicado: 0, ignorado: 0, fallido: 0 });
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
    lote("page", PAGE_ID, [evento({ text: "respuesta", isEcho: true }), evento({ adjunto: true })]),
    deps,
  );
  assert.deepEqual(resumen, { encolado: 0, duplicado: 0, ignorado: 2, fallido: 0 });
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
  deps.findMessageByExternalId = async () => (yaEsta ? { id: "m" } : null);
  const resumen = await procesarWebhookDeMeta(
    lote("page", PAGE_ID, [evento({ text: "Hola" })]),
    deps,
  );
  assert.equal(resumen.duplicado, 1);
});

test("agente inexistente, inactivo o sin el canal: ignorado sin crear contacto", async () => {
  const base = {
    id: "agente-1",
    organizationId: ORG,
    branchId: "sucursal-1",
    isActive: true,
    channels: ["MESSENGER"] as ConversationChannel[],
  };
  const casos: { nombre: string; agente: Agente; object: string; cuenta: string }[] = [
    { nombre: "sin agente", agente: null, object: "page", cuenta: PAGE_ID },
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
    // Tiene Messenger pero no Instagram: el mensaje de Instagram se ignora.
    { nombre: "sin INSTAGRAM", agente: base, object: "instagram", cuenta: IGID },
  ];
  for (const caso of casos) {
    const { deps, estado } = dobles({ agente: caso.agente });
    const resumen = await procesarWebhookDeMeta(
      lote(caso.object, caso.cuenta, [evento({ text: "Hola" })]),
      deps,
    );
    assert.equal(resumen.ignorado, 1, caso.nombre);
    assert.equal(estado.contactos.length, 0, caso.nombre);
    assert.equal(estado.jobs.length, 0, caso.nombre);
  }
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
  assert.deepEqual(resumen, { encolado: 1, duplicado: 0, ignorado: 0, fallido: 1 });
  assert.deepEqual(
    estado.jobs.map((j) => j.messageId),
    ["entrante-m_bueno"],
  );
});

test("otro objeto (whatsapp_business_account) o entry sin id / sin messaging: nada que hacer", async () => {
  const { deps, estado } = dobles();
  const vacio = { encolado: 0, duplicado: 0, ignorado: 0, fallido: 0 };
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
