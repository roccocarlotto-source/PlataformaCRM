import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import {
  esperarBloqueadoPor,
  sostenerTransaccion,
  type TransaccionSostenida,
} from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findOrCreateOpenConversation } from "../repositories/conversation.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { findRoleByName } from "../repositories/role.repository";
import {
  ejecutarHandoff,
  runAgentTurn,
  tomarLockDeConversacion,
} from "./agentOrchestration.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmProvider,
} from "./llmProvider.service";
import { resolveWidgetContact, widgetContactLastName } from "./widgetContact.service";

// ---------------------------------------------------------------------------
// Ítem 126 de docs/auditoria-2026-09-24-punta-a-punta.md (B-03, C-01, C-05)
// contra Postgres real: lo que impide que dos turnos del mismo contacto se
// pisen.
//
//   1. runAgentTurn toma el lock de la conversación ANTES de persistir nada:
//      con el lock sostenido por otra transacción, la llamada real queda
//      bloqueada en Postgres (no "termina antes"), y no escribe nada hasta
//      que se suelta.
//   2. Dos turnos concurrentes del mismo contacto nunca están a la vez
//      adentro del modelo, y el segundo ve la respuesta del primero.
//   3. conversations_open_unique: a lo sumo una abierta; el buscar-o-crear
//      concurrente converge a la misma fila.
//   4. ejecutarHandoff es un compare-and-swap: dos derivaciones concurrentes
//      dejan UNA Activity y UN brief.
//   5. resolveWidgetContact serializa por organización: el doble submit de
//      una sesión nueva deja UN contacto.
//
// Los casos 1, 4 y 5 usan la técnica de src/lib/carreras.test-helper.ts: la
// transacción de control toma el MISMO lock que la operación real (llamando a
// la misma función), y el test espera a que Postgres diga que la llamada real
// está bloqueada. Si el lock desapareciera del código, la llamada no se
// bloquearía nunca y el helper falla de forma determinista.
// ---------------------------------------------------------------------------

interface Fixture {
  orgId: string;
  branchId: string;
  agentId: string;
  ownerId: string;
  authId: string;
}

let fx: Fixture;

// El doble del LLM para los turnos y para el brief (generarBriefDeConversacion
// usa el proveedor global). Registra cuántas llamadas hay adentro a la vez.
let enCurso = 0;
let maximoEnCurso = 0;
let llamadas = 0;
let demoraMs = 0;

const doble: LlmProvider = {
  name: "doble",
  async complete() {
    llamadas++;
    enCurso++;
    maximoEnCurso = Math.max(maximoEnCurso, enCurso);
    try {
      if (demoraMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, demoraMs));
      }
      return { text: "Respuesta del doble", toolCalls: [] };
    } finally {
      enCurso--;
    }
  },
};

function reiniciarDoble(demora = 0) {
  enCurso = 0;
  maximoEnCurso = 0;
  llamadas = 0;
  demoraMs = demora;
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  setLlmProviderForTests(doble);

  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }
  const org = await prisma.organization.create({
    data: {
      name: `Concurrencia ${randomUUID()}`,
      slug: `concurrencia-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente",
      instructions: "Sos el agente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB", "WHATSAPP"],
      guardrails: {},
    },
  });

  // Identidad real en Supabase Auth: el trigger trg_set_user_email_from_auth
  // lee auth.users para completar users.email. Es el vendedor que recibe la
  // Activity de aviso de la derivación.
  const email = `concurrencia-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth: ${error?.message}`);
  }
  const owner = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: `placeholder-${data.user.id}@example.test`,
      fullName: "Vendedor",
    },
  });

  fx = {
    orgId: org.id,
    branchId: branch.id,
    agentId: agent.id,
    ownerId: owner.id,
    authId: data.user.id,
  };
});

after(async () => {
  resetLlmProviderParaTests();
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  await prisma.agentInboundJob.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.authId);
});

function crearContacto(conVendedor = true) {
  return prisma.contact.create({
    data: {
      organizationId: fx.orgId,
      firstName: "Ana",
      lastName: "Pérez",
      ownerId: conVendedor ? fx.ownerId : null,
    },
  });
}

function turnoWeb(contactId: string, texto: string) {
  return runAgentTurn({
    organizationId: fx.orgId,
    agentId: fx.agentId,
    contactId,
    channel: "WEB",
    texto,
  });
}

// ---------------------------------------------------------------------------
// 1 y 2. El lock del turno
// ---------------------------------------------------------------------------

test("runAgentTurn espera el lock de la conversación ANTES de escribir nada, y sigue cuando se suelta", async () => {
  reiniciarDoble();
  const contacto = await crearContacto();

  const a = await sostenerTransaccion((tx) =>
    tomarLockDeConversacion(tx, { agentId: fx.agentId, contactId: contacto.id, channel: "WEB" }),
  );
  const b = turnoWeb(contacto.id, "hola");
  await esperarBloqueadoPor(a, b, "runAgentTurn");

  // Bloqueado de verdad: ni conversación ni entrante, ni llamada al modelo.
  assert.equal(await prisma.conversation.count({ where: { contactId: contacto.id } }), 0);
  assert.equal(llamadas, 0);

  a.liberar();
  await a.terminada;
  const resultado = await b;
  assert.equal(resultado.respuesta, "Respuesta del doble");
  assert.equal(
    await prisma.message.count({ where: { conversationId: resultado.conversationId } }),
    2,
  );
});

test("el lock es por (agente, contacto, canal): el de OTRO contacto no bloquea", async () => {
  reiniciarDoble();
  const otro = await crearContacto();
  const contacto = await crearContacto();

  const a = await sostenerTransaccion((tx) =>
    tomarLockDeConversacion(tx, { agentId: fx.agentId, contactId: otro.id, channel: "WEB" }),
  );
  try {
    const resultado = await turnoWeb(contacto.id, "hola");
    assert.equal(resultado.respuesta, "Respuesta del doble");
  } finally {
    a.liberar();
    await a.terminada;
  }
});

test("dos turnos concurrentes del mismo contacto nunca están adentro del modelo a la vez, y el segundo ve la respuesta del primero", async () => {
  // Con 150 ms de "modelo", dos turnos sin lock se solaparían siempre.
  reiniciarDoble(150);
  const contacto = await crearContacto();

  const [r1, r2] = await Promise.all([
    turnoWeb(contacto.id, "hola"),
    turnoWeb(contacto.id, "quiero un auto"),
  ]);

  assert.equal(maximoEnCurso, 1, "B-03: los turnos se serializaron");
  assert.equal(llamadas, 2);
  assert.equal(r1.conversationId, r2.conversationId, "C-01: una sola conversación");

  const mensajes = await prisma.message.findMany({
    where: { conversationId: r1.conversationId },
    orderBy: { createdAt: "asc" },
  });
  // Entrante, respuesta, entrante, respuesta: el segundo turno arrancó
  // después de que el primero escribió todo.
  assert.deepEqual(
    mensajes.map((m) => m.direction),
    ["INBOUND", "OUTBOUND", "INBOUND", "OUTBOUND"],
  );
});

// ---------------------------------------------------------------------------
// 3. conversations_open_unique
// ---------------------------------------------------------------------------

test("la base rechaza una segunda conversación abierta del mismo contacto, agente y canal; una CLOSED no cuenta", async () => {
  const contacto = await crearContacto();
  const datos = {
    organizationId: fx.orgId,
    branchId: fx.branchId,
    agentId: fx.agentId,
    contactId: contacto.id,
    channel: "WHATSAPP" as const,
  };

  await prisma.conversation.create({ data: { ...datos, status: "CLOSED" } });
  await prisma.conversation.create({ data: { ...datos, status: "ACTIVE" } });
  await assert.rejects(
    prisma.conversation.create({ data: { ...datos, status: "TRANSFERRED_TO_HUMAN" } }),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
  );
  // Otro canal es otra conversación.
  await prisma.conversation.create({ data: { ...datos, channel: "WEB" } });
});

test("findOrCreateOpenConversation en paralelo converge a UNA fila: el P2002 del perdedor relee la ganadora", async () => {
  const contacto = await crearContacto();
  const datos = {
    organizationId: fx.orgId,
    branchId: fx.branchId,
    agentId: fx.agentId,
    contactId: contacto.id,
    channel: "WHATSAPP" as const,
  };

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => findOrCreateOpenConversation(datos)),
  );
  assert.equal(new Set(resultados.map((c) => c.id)).size, 1);
  assert.equal(
    await prisma.conversation.count({ where: { contactId: contacto.id, channel: "WHATSAPP" } }),
    1,
  );
});

// ---------------------------------------------------------------------------
// 4. ejecutarHandoff con compare-and-swap (C-05)
// ---------------------------------------------------------------------------

test("dos derivaciones concurrentes de la misma conversación -> UNA Activity de aviso y UN brief", async () => {
  reiniciarDoble();
  const contacto = await crearContacto();
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      agentId: fx.agentId,
      contactId: contacto.id,
      channel: "WEB",
    },
  });
  // El brief necesita algo que resumir.
  await prisma.message.create({
    data: {
      organizationId: fx.orgId,
      conversationId: conversacion.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Quiero hablar con una persona",
    },
  });

  // A sostiene la fila de la conversación. Las dos derivaciones pasan la
  // lectura de atajo (ven ACTIVE) y se bloquean en su UPDATE. Sin el status en
  // el WHERE, al soltar A las dos escribirían y las dos avisarían.
  const a = await sostenerTransaccion(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversacion.id}::uuid FOR UPDATE`;
  });
  const derivar = (motivo: string) =>
    ejecutarHandoff({
      organizationId: fx.orgId,
      conversationId: conversacion.id,
      branchId: fx.branchId,
      contact: { id: contacto.id, ownerId: fx.ownerId, firstName: "Ana", lastName: "Pérez" },
      agentName: "Agente",
      motivo,
    });
  const ambas = Promise.all([derivar("primera"), derivar("segunda")]);
  await esperarBloqueadoPor(a, ambas, "ejecutarHandoff");
  await esperarBackendsBloqueados(a, 2);

  a.liberar();
  await a.terminada;
  const [r1, r2] = await ambas;

  assert.equal(
    [r1.activityId, r2.activityId].filter((id) => id !== null).length,
    1,
    "solo quien ganó la transición avisa",
  );
  assert.equal(await prisma.activity.count({ where: { contactId: contacto.id } }), 1);
  assert.equal(llamadas, 1, "un solo brief (una sola llamada al LLM)");
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: conversacion.id } });
  assert.equal(despues.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(despues.assignedUserId, fx.ownerId);
});

// esperarBloqueadoPor vuelve con el PRIMER backend bloqueado; acá hacen falta
// los dos, para que la carrera sea real y no una ejecución en serie. Se cuenta
// la cadena y no solo los bloqueados DIRECTAMENTE por A: el segundo en llegar
// espera al primero (Postgres encola los pedidos del mismo lock), así que su
// pg_blocking_pids nombra al primero, no a A. Si el plazo vence se suelta A
// antes de fallar, para que el teardown no espere el timeout de su transacción.
async function esperarBackendsBloqueados(
  a: TransaccionSostenida,
  cuantos: number,
  plazoMs = 10_000,
) {
  const limite = Date.now() + plazoMs;
  while (Date.now() < limite) {
    const filas = await prisma.$queryRaw<{ pid: number; bloqueadores: number[] }[]>`
      SELECT pid, pg_blocking_pids(pid) AS bloqueadores FROM pg_stat_activity
      WHERE cardinality(pg_blocking_pids(pid)) > 0
    `;
    const cadena = new Set<number>([a.pid]);
    let crecio = true;
    while (crecio) {
      crecio = false;
      for (const fila of filas) {
        if (!cadena.has(fila.pid) && fila.bloqueadores.some((p) => cadena.has(p))) {
          cadena.add(fila.pid);
          crecio = true;
        }
      }
    }
    if (cadena.size - 1 >= cuantos) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  a.liberar();
  assert.fail(
    `en ${String(plazoMs)} ms no aparecieron ${String(cuantos)} backends bloqueados detrás de A`,
  );
}

// ---------------------------------------------------------------------------
// 5. resolveWidgetContact (B-03, el mismo lock que whatsappContact.service)
// ---------------------------------------------------------------------------

test("dos primeros mensajes concurrentes de la MISMA sesión del widget -> un solo contacto y una sola conversación", async () => {
  const sessionId = `sesion-${randomUUID()}`;

  const a = await sostenerTransaccion((tx) => lockOrganizationForUpdate(fx.orgId, tx));
  const resolver = () =>
    resolveWidgetContact(fx.orgId, fx.agentId, fx.branchId, "WEB", sessionId, randomUUID());
  const ambas = Promise.all([resolver(), resolver()]);
  await esperarBloqueadoPor(a, ambas, "resolveWidgetContact");
  await esperarBackendsBloqueados(a, 2);

  a.liberar();
  await a.terminada;
  const [c1, c2] = await ambas;

  assert.equal(c1, c2, "los dos requests quedan atados al mismo contacto");
  assert.equal(
    await prisma.contact.count({
      where: { organizationId: fx.orgId, lastName: widgetContactLastName(sessionId) },
    }),
    1,
  );
  const conversaciones = await prisma.conversation.findMany({
    where: { organizationId: fx.orgId, externalThreadId: sessionId },
  });
  assert.equal(conversaciones.length, 1);
  assert.equal(conversaciones[0].contactId, c1);
  assert.equal(conversaciones[0].branchId, fx.branchId);
  assert.equal(conversaciones[0].status, "ACTIVE");

  // Y el turno usa esa misma conversación, no abre otra.
  reiniciarDoble();
  const resultado = await runAgentTurn({
    organizationId: fx.orgId,
    agentId: fx.agentId,
    contactId: c1,
    channel: "WEB",
    texto: "hola",
    externalThreadId: sessionId,
  });
  assert.equal(resultado.conversationId, conversaciones[0].id);
});
