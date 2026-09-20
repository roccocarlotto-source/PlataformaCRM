import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { BRIEF_MAX_LENGTH, generarBriefDeConversacion } from "./conversationBrief.service";
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// La generación del brief (ítem 73) contra Postgres real, con un LlmProvider
// FALSO inyectado. Misma división que agentOrchestration.integration-test.ts:
// lo externo se dobla, todo lo demás es real — los mensajes que se leen, el
// orden en que salen del índice, y las dos columnas que quedan escritas.
//
// Lo que se prueba acá y no se puede probar sin base:
//
//   1. El transcript que recibe el modelo sale de los mensajes REALES, en el
//      orden real de createdAt, con el rótulo de cada autor.
//   2. El brief queda GUARDADO en la fila.
//   3. briefEditedByUserId vuelve a null incluso si una persona lo había
//      editado antes — regenerar pisa todo, y es lo esperado.
//   4. Una conversación sin mensajes es 400 y NO llama al proveedor.
//   5. El aislamiento: los mensajes se leen con organizationId en el WHERE.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN: el runner corre los archivos de
// integración en paralelo contra una base compartida.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";

interface Doble {
  proveedor: LlmProvider;
  requests: LlmCompletionRequest[];
}

function doblarProveedor(resultado: LlmCompletionResult): Doble {
  const requests: LlmCompletionRequest[] = [];
  return {
    requests,
    proveedor: {
      name: "doble",
      complete(request) {
        requests.push(request);
        return Promise.resolve(resultado);
      },
    },
  };
}

function texto(content: string | null): LlmCompletionResult {
  return { text: content, toolCalls: [] };
}

interface Escenario {
  organizationId: string;
  conversationId: string;
  userId: string;
  authUserId: string;
}

// Identidad REAL en Supabase Auth, igual que agentOrchestration.integration-test.ts
// y conversation.controller.integration-test.ts. No es opcional: el trigger
// trg_set_user_email_from_auth lee auth.users para completar users.email, así
// que un id inventado deja el email en NULL y el INSERT muere contra el NOT
// NULL de la columna.
async function crearAuthUser(etiqueta: string): Promise<string> {
  const email = `brief-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear usuario real de Supabase Auth (${etiqueta}): ${error?.message}`,
    );
  }
  return data.user.id;
}

// Cada test limpia lo suyo: el runner corre los archivos de integración en
// paralelo contra una base compartida, y dejar organizaciones colgadas ensucia
// los conteos de los demás. El orden respeta las FKs.
async function desmontar(e: Escenario) {
  const where = { organizationId: e.organizationId };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: e.organizationId } });
  await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
}

// Un mensaje por entrada, con createdAt explícito y separado, para poder
// afirmar el ORDEN sin depender de la velocidad de los INSERT.
interface MensajeDeEscenario {
  senderType: "CONTACT" | "AGENT" | "HUMAN";
  content: string;
  minuto: number;
}

async function montar(etiqueta: string, mensajes: MensajeDeEscenario[]): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: {
      name: `Brief ${etiqueta} ${randomUUID()}`,
      slug: `brief-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  const authUserId = await crearAuthUser(etiqueta);
  const user = await prisma.user.create({
    data: {
      id: authUserId,
      organizationId: org.id,
      roleId: adminRole.id,
      // El trigger lo pisa con el de auth.users; este es solo el placeholder
      // que satisface el NOT NULL, mismo patrón que el resto de los tests.
      email: `placeholder-${authUserId}@example.test`,
      fullName: `Vendedor ${etiqueta}`,
    },
  });

  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: TZ },
  });

  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WEB"],
    },
  });

  const contact = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Ana", lastName: "Pérez" },
  });

  const conversation = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      agentId: agent.id,
      contactId: contact.id,
      channel: "WEB",
    },
  });

  if (mensajes.length > 0) {
    await prisma.message.createMany({
      data: mensajes.map((m) => ({
        organizationId: org.id,
        conversationId: conversation.id,
        direction: m.senderType === "CONTACT" ? ("INBOUND" as const) : ("OUTBOUND" as const),
        senderType: m.senderType,
        ...(m.senderType === "HUMAN" ? { senderUserId: user.id } : {}),
        content: m.content,
        createdAt: new Date(`2026-03-03T10:${String(m.minuto).padStart(2, "0")}:00.000Z`),
      })),
    });
  }

  return {
    organizationId: org.id,
    conversationId: conversation.id,
    userId: user.id,
    authUserId,
  };
}

function leerConversacion(id: string) {
  return prisma.conversation.findUniqueOrThrow({
    where: { id },
    select: { brief: true, briefEditedByUserId: true },
  });
}

const HILO: MensajeDeEscenario[] = [
  { senderType: "CONTACT", content: "Hola, quiero saber el precio del Corolla", minuto: 1 },
  { senderType: "AGENT", content: "Te paso la lista de precios", minuto: 2 },
  { senderType: "CONTACT", content: "¿Y financiación?", minuto: 3 },
  { senderType: "HUMAN", content: "Sigo yo, te llamo en un rato", minuto: 4 },
];

// ---------------------------------------------------------------------------
// Lo que se le manda al modelo
// ---------------------------------------------------------------------------

test("el transcript sale de los mensajes reales, en orden y con el rótulo de cada autor", async () => {
  const e = await montar("transcript", HILO);
  try {
    const doble = doblarProveedor(texto("Ana consultó precio y financiación del Corolla."));

    await generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor);

    assert.equal(doble.requests.length, 1, "una sola llamada al proveedor");
    const [request] = doble.requests;
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0].role, "user");

    // El orden es el de createdAt, que es el del índice (conversation_id,
    // created_at) — no el de inserción ni el de la PK.
    assert.equal(
      (request.messages[0] as { content: string }).content,
      [
        "Cliente: Hola, quiero saber el precio del Corolla",
        "Agente: Te paso la lista de precios",
        "Cliente: ¿Y financiación?",
        "Humano: Sigo yo, te llamo en un rato",
      ].join("\n"),
    );
  } finally {
    await desmontar(e);
  }
});

test("se llama SIN tools y con el system prompt del brief", async () => {
  const e = await montar("sin-tools", HILO);
  try {
    const doble = doblarProveedor(texto("Resumen."));

    await generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor);

    const [request] = doble.requests;
    // Sin tools: esto es un resumen, no una conversación con tool-calling.
    assert.deepEqual(request.tools, []);
    // Y sin `model`: resumir es una tarea de criterio fijo, no depende del
    // modelName del agente que atendió.
    assert.equal(request.model, undefined);
    assert.match(request.systemPrompt, /2 a 4 oraciones/);
  } finally {
    await desmontar(e);
  }
});

test("el brief queda guardado en la fila, y la función devuelve el mismo texto", async () => {
  const e = await montar("guardar", HILO);
  try {
    const doble = doblarProveedor(texto("  Ana consultó el precio del Corolla.  "));

    const devuelto = await generarBriefDeConversacion(
      e.organizationId,
      e.conversationId,
      doble.proveedor,
    );

    // Trimeado: el modelo suele devolver el texto con espacios alrededor.
    assert.equal(devuelto, "Ana consultó el precio del Corolla.");
    const fila = await leerConversacion(e.conversationId);
    assert.equal(fila.brief, "Ana consultó el precio del Corolla.");
    // Es contenido de la IA, aunque lo haya disparado una persona.
    assert.equal(fila.briefEditedByUserId, null);
  } finally {
    await desmontar(e);
  }
});

test("regenerar PISA una edición humana previa y devuelve briefEditedByUserId a null", async () => {
  const e = await montar("pisa", HILO);
  try {
    // Una persona lo había corregido a mano.
    await prisma.conversation.update({
      where: { id: e.conversationId },
      data: { brief: "Lo escribí yo a mano.", briefEditedByUserId: e.userId },
    });

    const doble = doblarProveedor(texto("Resumen nuevo del modelo."));
    await generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor);

    const fila = await leerConversacion(e.conversationId);
    assert.equal(fila.brief, "Resumen nuevo del modelo.");
    // No es un efecto colateral: quien regenera está pidiendo el texto de la IA,
    // y la columna dice quién escribió el texto que HOY está guardado.
    assert.equal(fila.briefEditedByUserId, null);
  } finally {
    await desmontar(e);
  }
});

test("un resumen entrecomillado por el modelo se guarda sin las comillas", async () => {
  const e = await montar("comillas", HILO);
  try {
    const doble = doblarProveedor(texto('"Ana consultó el precio."'));

    await generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor);

    assert.equal((await leerConversacion(e.conversationId)).brief, "Ana consultó el precio.");
  } finally {
    await desmontar(e);
  }
});

test("un resumen desbocado se recorta al tope de la columna", async () => {
  const e = await montar("largo", HILO);
  try {
    const doble = doblarProveedor(texto("x".repeat(BRIEF_MAX_LENGTH + 500)));

    const devuelto = await generarBriefDeConversacion(
      e.organizationId,
      e.conversationId,
      doble.proveedor,
    );

    assert.equal(devuelto.length, BRIEF_MAX_LENGTH);
    assert.equal((await leerConversacion(e.conversationId)).brief?.length, BRIEF_MAX_LENGTH);
  } finally {
    await desmontar(e);
  }
});

test("una conversación sin mensajes es 400 y NO gasta una llamada al proveedor", async () => {
  const e = await montar("vacia", []);
  try {
    const doble = doblarProveedor(texto("no debería llamarse"));

    await assert.rejects(
      () => generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 400 &&
        /todavía no tiene mensajes/.test(err.message),
    );

    assert.equal(doble.requests.length, 0, "no se llama al modelo si no hay nada que resumir");
    assert.equal((await leerConversacion(e.conversationId)).brief, null);
  } finally {
    await desmontar(e);
  }
});

test("una conversación con mensajes todos en blanco también es 400", async () => {
  const e = await montar("en-blanco", [{ senderType: "CONTACT", content: "   ", minuto: 1 }]);
  try {
    const doble = doblarProveedor(texto("no debería llamarse"));

    await assert.rejects(() =>
      generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor),
    );
    assert.equal(doble.requests.length, 0);
  } finally {
    await desmontar(e);
  }
});

test("si el modelo no devuelve texto, no se guarda un brief vacío", async () => {
  const e = await montar("sin-texto", HILO);
  try {
    for (const respuesta of [texto(null), texto("   ")]) {
      const doble = doblarProveedor(respuesta);
      await assert.rejects(() =>
        generarBriefDeConversacion(e.organizationId, e.conversationId, doble.proveedor),
      );
    }

    // Guardar "" sería peor que no guardar nada: la pantalla lo mostraría como
    // un brief vacío en vez de volver a ofrecer generarlo.
    assert.equal((await leerConversacion(e.conversationId)).brief, null);
  } finally {
    await desmontar(e);
  }
});

test("el aislamiento: con el organizationId de otra organización no hay transcript", async () => {
  const e = await montar("aislada", HILO);
  const otra = await montar("aislada-otra", []);
  try {
    const doble = doblarProveedor(texto("no debería llamarse"));

    // Los mensajes se leen con organizationId en el WHERE, así que desde otra
    // organización la conversación se ve vacía y no hay nada que resumir — nunca
    // el transcript de una conversación ajena.
    await assert.rejects(() =>
      generarBriefDeConversacion(otra.organizationId, e.conversationId, doble.proveedor),
    );
    assert.equal(doble.requests.length, 0);
    assert.equal((await leerConversacion(e.conversationId)).brief, null);
  } finally {
    await desmontar(otra);
    await desmontar(e);
  }
});
