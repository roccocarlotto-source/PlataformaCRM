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
  soltarLease,
  tomarLease,
  type LeaseDelTurno,
} from "../repositories/agentTurnLease.repository";
import { AppError } from "../utils/AppError";
import {
  claveDeLockDeConversacion,
  ejecutarHandoff,
  runAgentTurn,
} from "./agentOrchestration.service";
import { conLeaseDelTurno, conLeaseVigente, LeasePerdidoError } from "./leaseDelTurno";
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

// Un lease de la clave sostenido por "otro proceso": la fila de
// agent_turn_leases con otro holder, vigente por un buen rato. Se toma con la
// MISMA función que usa el turno (tomarLease), nunca con un INSERT a mano.
async function tomarLeaseAjeno(contactId: string): Promise<LeaseDelTurno> {
  const lease: LeaseDelTurno = {
    lockKey: claveDeLockDeConversacion({ agentId: fx.agentId, contactId, channel: "WEB" }),
    organizationId: fx.orgId,
    holderId: randomUUID(),
  };
  assert.equal(await tomarLease(lease, 60_000), true);
  return lease;
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cuántas transacciones nuestras hay abiertas en Postgres ahora mismo, sin
// contar esta consulta. Con el lease, un turno que espera o que espera al
// modelo no tiene ninguna.
async function transaccionesAbiertas(): Promise<number> {
  const filas = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state LIKE 'idle in transaction%'`;
  return Number(filas[0].n);
}

test("runAgentTurn espera el lock de la conversación ANTES de escribir nada, y sigue cuando se suelta", async () => {
  reiniciarDoble();
  const contacto = await crearContacto();

  const ajeno = await tomarLeaseAjeno(contacto.id);
  let termino = false;
  const b = turnoWeb(contacto.id, "hola").finally(() => {
    termino = true;
  });
  // Varios reintentos del lease (el primero a los 100 ms): sin el lock, el
  // turno con el doble habría respondido en milisegundos.
  await esperar(1_000);

  assert.equal(termino, false, "el turno sigue esperando el lock");
  assert.equal(await prisma.conversation.count({ where: { contactId: contacto.id } }), 0);
  assert.equal(llamadas, 0);
  assert.equal(
    await transaccionesAbiertas(),
    0,
    "esperar el lock no tiene una transacción abierta",
  );

  await soltarLease(ajeno);
  const resultado = await b;
  assert.equal(resultado.respuesta, "Respuesta del doble");
  assert.equal(
    await prisma.message.count({ where: { conversationId: resultado.conversationId } }),
    2,
  );
  assert.equal(
    await prisma.agentTurnLease.count({ where: { lockKey: ajeno.lockKey } }),
    0,
    "al terminar, el turno soltó el lease",
  );
});

test("el lock es por (agente, contacto, canal): el de OTRO contacto no bloquea", async () => {
  reiniciarDoble();
  const otro = await crearContacto();
  const contacto = await crearContacto();

  const ajeno = await tomarLeaseAjeno(otro.id);
  try {
    const resultado = await turnoWeb(contacto.id, "hola");
    assert.equal(resultado.respuesta, "Respuesta del doble");
  } finally {
    await soltarLease(ajeno);
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

// C-12 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): unos pocos mensajes seguidos por el widget llenaban el pool,
// porque cada turno esperaba el lock con una conexión tomada. Con el lease,
// ningún turno que espera tiene una conexión ni una transacción abierta, y
// mientras el modelo piensa tampoco.
test("C-12: cinco turnos de la misma sesión esperando el lock no tienen ninguna transacción abierta", async () => {
  reiniciarDoble(300);
  const contacto = await crearContacto();

  const ajeno = await tomarLeaseAjeno(contacto.id);
  const turnos = Promise.all(
    Array.from({ length: 5 }, (_, i) => turnoWeb(contacto.id, `mensaje ${String(i)}`)),
  );
  await esperar(500);
  const esperando = await transaccionesAbiertas();

  await soltarLease(ajeno);
  // Con un turno adentro del "modelo" (300 ms).
  await esperar(150);
  const pensando = await transaccionesAbiertas();
  const resultados = await turnos;

  assert.equal(esperando, 0, "esperando el lock: ninguna transacción abierta");
  assert.equal(pensando, 0, "esperando al modelo: ninguna transacción abierta");
  assert.equal(llamadas, 5);
  assert.equal(maximoEnCurso, 1);
  assert.equal(new Set(resultados.map((r) => r.conversationId)).size, 1);
});

// ---------------------------------------------------------------------------
// El lease (services/leaseDelTurno.ts): entre procesos, vencimiento,
// renovación, espera máxima y fencing. Directo sobre conLeaseDelTurno, sin el
// limitador en memoria: así dos llamadas son como dos procesos.
// ---------------------------------------------------------------------------

function claveDePrueba(): string {
  return `agent-turn:test:${randomUUID()}:WEB`;
}

const SIN_LIMITE = { limiteDelTurnoMs: 60_000, esperaMaximaMs: 10_000 };

test("lease: dos procesos con la misma clave se turnan; nunca están adentro a la vez", async () => {
  const lockKey = claveDePrueba();
  let adentro = 0;
  let maximo = 0;
  const turno = () =>
    conLeaseDelTurno(
      lockKey,
      fx.orgId,
      async () => {
        adentro++;
        maximo = Math.max(maximo, adentro);
        await esperar(200);
        adentro--;
      },
      SIN_LIMITE,
    );
  await Promise.all([turno(), turno(), turno()]);
  assert.equal(maximo, 1);
  assert.equal(await prisma.agentTurnLease.count({ where: { lockKey } }), 0);
});

test("lease: el de un proceso muerto (sin renovar) vence solo y el siguiente sigue", async () => {
  const lockKey = claveDePrueba();
  const muerto: LeaseDelTurno = { lockKey, organizationId: fx.orgId, holderId: randomUUID() };
  assert.equal(await tomarLease(muerto, 400), true);

  const inicio = Date.now();
  const resultado = await conLeaseDelTurno(lockKey, fx.orgId, async () => "siguió", SIN_LIMITE);
  assert.equal(resultado, "siguió");
  assert.ok(Date.now() - inicio >= 300, "esperó a que venciera");
});

test("lease: mientras el turno corre se renueva, y nadie se lo saca aunque dure más que el lease", async () => {
  const lockKey = claveDePrueba();
  let otroPudo: boolean | undefined;
  let abiertas: number | undefined;
  await conLeaseDelTurno(
    lockKey,
    fx.orgId,
    async () => {
      // Dura más de tres veces el lease (400 ms), renovado cada 100 ms.
      await esperar(1_300);
      otroPudo = await tomarLease(
        { lockKey, organizationId: fx.orgId, holderId: randomUUID() },
        60_000,
      );
      abiertas = await transaccionesAbiertas();
    },
    { ...SIN_LIMITE, duracionMs: 400, renovarCadaMs: 100 },
  );
  assert.equal(otroPudo, false);
  assert.equal(abiertas, 0, "el turno con el lease no tiene una transacción abierta");
});

test("lease: pasada la espera máxima, 409 y el turno no corre", async () => {
  const lockKey = claveDePrueba();
  const ajeno: LeaseDelTurno = { lockKey, organizationId: fx.orgId, holderId: randomUUID() };
  assert.equal(await tomarLease(ajeno, 60_000), true);
  let corrio = false;
  try {
    await assert.rejects(
      conLeaseDelTurno(
        lockKey,
        fx.orgId,
        async () => {
          corrio = true;
        },
        { limiteDelTurnoMs: 60_000, esperaMaximaMs: 300 },
      ),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    assert.equal(corrio, false);
  } finally {
    await soltarLease(ajeno);
  }
});

test("lease: FENCING: un turno que perdió el lease no escribe", async () => {
  const lockKey = claveDePrueba();
  const contacto = await crearContacto();
  await assert.rejects(
    conLeaseDelTurno(
      lockKey,
      fx.orgId,
      async () => {
        // Sin renovación (cada 60 s) y con un lease de 300 ms: vence, y otro
        // proceso lo toma mientras este "espera al modelo".
        await esperar(500);
        assert.equal(
          await tomarLease({ lockKey, organizationId: fx.orgId, holderId: randomUUID() }, 60_000),
          true,
        );
        await conLeaseVigente((db) =>
          db.contact.update({ where: { id: contacto.id }, data: { lastName: "Pisado" } }),
        );
      },
      { ...SIN_LIMITE, duracionMs: 300, renovarCadaMs: 60_000 },
    ),
    LeasePerdidoError,
  );
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contacto.id } });
  assert.equal(despues.lastName, "Pérez", "la escritura no se hizo");
  // El lease del otro sigue: soltar el propio no lo borra.
  assert.equal(await prisma.agentTurnLease.count({ where: { lockKey } }), 1);
  await prisma.agentTurnLease.deleteMany({ where: { lockKey } });
});

test("lease: fuera de un turno, conLeaseVigente escribe directo", async () => {
  const contacto = await crearContacto();
  await conLeaseVigente((db) =>
    db.contact.update({ where: { id: contacto.id }, data: { lastName: "Directo" } }),
  );
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: contacto.id } });
  assert.equal(despues.lastName, "Directo");
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

// B-16 de docs-privados/auditoria-2026-09-30-corta.md (local): el turno de
// la conversación A deriva justo cuando un vendedor la cerró y el contacto ya
// abrió B. Con el CAS viejo (`not TRANSFERRED_TO_HUMAN`) el UPDATE pasaba A de
// CLOSED a TRANSFERRED y chocaba con conversations_open_unique (P2002): el
// worker lo trataba como transitorio y repetía el turno entero hasta FAILED.
test("B-16: derivar una conversación que se cerró en el medio (y el contacto ya abrió otra) no la reabre ni falla", async () => {
  reiniciarDoble();
  const contacto = await crearContacto();
  const datos = {
    organizationId: fx.orgId,
    branchId: fx.branchId,
    agentId: fx.agentId,
    contactId: contacto.id,
    channel: "WEB" as const,
  };
  const a = await prisma.conversation.create({ data: datos });

  // La transacción sostenida hace lo del vendedor y el contacto —cerrar A y
  // abrir B— sin commitear. La derivación lee A todavía ACTIVE (el cambio no
  // está commiteado), pasa el atajo y se bloquea en su UPDATE; al soltar, el
  // UPDATE reevalúa el WHERE contra A ya CLOSED.
  let bId = "";
  const vendedor = await sostenerTransaccion(async (tx) => {
    await tx.conversation.update({ where: { id: a.id }, data: { status: "CLOSED" } });
    const b = await tx.conversation.create({ data: datos });
    bId = b.id;
  });
  const derivacion = ejecutarHandoff({
    organizationId: fx.orgId,
    conversationId: a.id,
    branchId: fx.branchId,
    contact: { id: contacto.id, ownerId: fx.ownerId, firstName: "Ana", lastName: "Pérez" },
    agentName: "Agente",
    motivo: "quiere una persona",
  });
  await esperarBloqueadoPor(vendedor, derivacion, "ejecutarHandoff");
  vendedor.liberar();
  await vendedor.terminada;

  const resultado = await derivacion;

  assert.equal(resultado.activityId, null, "no se avisa: no hubo derivación");
  assert.equal(await prisma.activity.count({ where: { contactId: contacto.id } }), 0);
  const despuesA = await prisma.conversation.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(despuesA.status, "CLOSED", "A sigue cerrada");
  const despuesB = await prisma.conversation.findUniqueOrThrow({ where: { id: bId } });
  assert.equal(despuesB.status, "ACTIVE", "B no se tocó");
});

test("B-16: derivar una conversación ya CLOSED es un no-op, sin aviso ni brief", async () => {
  reiniciarDoble();
  const contacto = await crearContacto();
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      agentId: fx.agentId,
      contactId: contacto.id,
      channel: "WEB",
      status: "CLOSED",
    },
  });

  const resultado = await ejecutarHandoff({
    organizationId: fx.orgId,
    conversationId: conversacion.id,
    branchId: fx.branchId,
    contact: { id: contacto.id, ownerId: fx.ownerId, firstName: "Ana", lastName: "Pérez" },
    agentName: "Agente",
    motivo: "quiere una persona",
  });

  assert.equal(resultado.activityId, null);
  assert.equal(llamadas, 0);
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: conversacion.id } });
  assert.equal(despues.status, "CLOSED");
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
    if ((await contarBloqueadosDetrasDe(a)) >= cuantos) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  a.liberar();
  assert.fail(
    `en ${String(plazoMs)} ms no aparecieron ${String(cuantos)} backends bloqueados detrás de A`,
  );
}

// Cuántos backends esperan, directa o indirectamente, a la transacción A.
async function contarBloqueadosDetrasDe(a: TransaccionSostenida): Promise<number> {
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
  return cadena.size - 1;
}

// ---------------------------------------------------------------------------
// 5. resolveWidgetContact (B-03, el mismo lock que whatsappContact.service)
// ---------------------------------------------------------------------------

test("dos primeros mensajes concurrentes de la MISMA sesión del widget -> un solo contacto y una sola conversación", async () => {
  const sessionId = `sesion-${randomUUID()}`;

  const a = await sostenerTransaccion(async (tx) => {
    await lockOrganizationForUpdate(fx.orgId, tx);
  });
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
