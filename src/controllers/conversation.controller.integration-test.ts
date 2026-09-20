import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { conversationRouter } from "../routes/conversation.routes";

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md)
// por HTTP real contra una app Express real, montando el router real —con su
// authenticate— contra Postgres y GoTrue reales. Mismo patrón que
// knowledgeBaseEntry.controller.integration-test.ts.
//
// Lo que se prueba acá y no se puede probar sin base ni sin la cadena real:
//
//   1. PERMISOS AL REVÉS DE LOS DEMÁS MÓDULOS DEL AGENTE: un USER autenticado
//      lee la lista y el detalle. No hace falta ser ADMIN — es lo contrario
//      de lo que testean Agent/KB/Automation en sus rutas de escritura,
//      porque acá no hay ninguna escritura que gatear.
//   2. Aislamiento multi-tenant: una conversación de la organización B no
//      aparece en la lista de la A ni se puede abrir por id (404, no 403).
//   3. Cada filtro por separado y la búsqueda por contacto, contra filas
//      reales.
//   4. Paginación y orden por defecto (último mensaje primero, las que no
//      tienen mensajes al final).
//   5. El detalle devuelve el hilo COMPLETO en orden cronológico, con el
//      autor de cada mensaje y con toolCalls tal cual se persistió.
//
// CADA ORGANIZACIÓN DE ESTE ARCHIVO ES PROPIA. El runner corre los archivos
// de integración en paralelo contra una base compartida; sin aislar por
// organización, dos archivos se pisarían los conteos del listado.
// ---------------------------------------------------------------------------

const PASSWORD = "Conv-test-password-123!";
const TZ = "America/Montevideo";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
  userId: string;
}

interface Organizacion {
  id: string;
  branchA: string;
  branchB: string;
  agentA: string;
  agentB: string;
  contactAna: string;
  contactAnaEmail: string;
  contactBruno: string;
}

let orgA: Organizacion;
let orgB: Organizacion;
let adminA: FixtureUser;
let userA: FixtureUser;
let adminB: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;

// Las conversaciones de la organización A que arma el `before`, para poder
// referirlas por nombre en los tests.
let convWhatsappAna: string;
let convWebBruno: string;
let convCerradaAna: string;
let convSinMensajes: string;
let convDeOtraOrg: string;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", conversationRouter);
  app.use(notFound);
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function crearOrganizacion(etiqueta: string): Promise<Organizacion> {
  const org = await prisma.organization.create({
    data: {
      name: `Conv ${etiqueta} ${randomUUID()}`,
      slug: `conv-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  const branchA = await prisma.branch.create({
    data: { organizationId: org.id, name: `Centro ${etiqueta}`, timezone: TZ },
  });
  const branchB = await prisma.branch.create({
    data: { organizationId: org.id, name: `Costa ${etiqueta}`, timezone: TZ },
  });

  const agentBase = {
    organizationId: org.id,
    instructions: "Atendé consultas.",
    modelProvider: "openrouter",
    modelName: "test/model",
    enabledTools: [],
    guardrails: {},
  };
  const agentA = await prisma.agent.create({
    data: { ...agentBase, branchId: branchA.id, name: `Vera ${etiqueta}`, channels: ["WHATSAPP"] },
  });
  const agentB = await prisma.agent.create({
    data: { ...agentBase, branchId: branchB.id, name: `Nilo ${etiqueta}`, channels: ["WEB"] },
  });

  const contactAna = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Ana",
      lastName: "Pérez",
      email: `ana-${randomUUID().slice(0, 8)}@example.test`,
    },
  });
  const contactBruno = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Bruno",
      lastName: "Giménez",
      email: `bruno-${randomUUID().slice(0, 8)}@example.test`,
    },
  });

  return {
    id: org.id,
    branchA: branchA.id,
    branchB: branchB.id,
    agentA: agentA.id,
    agentB: agentB.id,
    contactAna: contactAna.id,
    contactAnaEmail: contactAna.email!,
    contactBruno: contactBruno.id,
  };
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `conv-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }

  const roleRow = await findRoleByName(role);
  if (!roleRow) {
    throw new Error(`No está sembrado el rol ${role}. Abortando.`);
  }

  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Conv Test ${label}`,
    },
  });

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
  }

  return {
    accessToken: signInData.session.access_token,
    authUserId: data.user.id,
    userId: user.id,
  };
}

interface DatosDeConversacion {
  org: Organizacion;
  agentId: string;
  branchId: string;
  contactId: string;
  channel: "WHATSAPP" | "WEB";
  status?: "ACTIVE" | "TRANSFERRED_TO_HUMAN" | "CLOSED";
  lastMessageAt?: Date;
}

async function crearConversacion(datos: DatosDeConversacion): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: datos.org.id,
      branchId: datos.branchId,
      agentId: datos.agentId,
      contactId: datos.contactId,
      channel: datos.channel,
      ...(datos.status ? { status: datos.status } : {}),
      ...(datos.lastMessageAt ? { lastMessageAt: datos.lastMessageAt } : {}),
    },
  });
  return conversation.id;
}

function call(method: string, path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function listar(
  token: string,
  query = "",
): Promise<{ data: Fila[]; pagination: Paginacion }> {
  const res = await call("GET", `/api/conversations${query}`, token);
  const crudo = await res.text();
  assert.equal(res.status, 200, `no se pudo listar (${query}): ${crudo}`);
  return JSON.parse(crudo) as { data: Fila[]; pagination: Paginacion };
}

interface Paginacion {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Fila {
  id: string;
  organizationId: string;
  branchId: string;
  agentId: string;
  contactId: string;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  contact: { id: string; firstName: string; lastName: string };
  agent: { id: string; name: string };
  branch: { id: string; name: string };
}

function ids(filas: Fila[]): string[] {
  return filas.map((fila) => fila.id);
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  adminA = await createFixtureUser("admin-a", orgA.id, "ADMIN");
  userA = await createFixtureUser("user-a", orgA.id, "USER");
  adminB = await createFixtureUser("admin-b", orgB.id, "ADMIN");

  // Fechas fijas y separadas: el orden por defecto (último mensaje primero)
  // tiene que ser verificable sin depender de la velocidad de los INSERT.
  convWhatsappAna = await crearConversacion({
    org: orgA,
    agentId: orgA.agentA,
    branchId: orgA.branchA,
    contactId: orgA.contactAna,
    channel: "WHATSAPP",
    status: "TRANSFERRED_TO_HUMAN",
    lastMessageAt: new Date("2026-03-03T10:00:00.000Z"),
  });
  convWebBruno = await crearConversacion({
    org: orgA,
    agentId: orgA.agentB,
    branchId: orgA.branchB,
    contactId: orgA.contactBruno,
    channel: "WEB",
    lastMessageAt: new Date("2026-03-02T10:00:00.000Z"),
  });
  convCerradaAna = await crearConversacion({
    org: orgA,
    agentId: orgA.agentA,
    branchId: orgA.branchA,
    contactId: orgA.contactAna,
    channel: "WEB",
    status: "CLOSED",
    lastMessageAt: new Date("2026-03-01T10:00:00.000Z"),
  });
  // Sin lastMessageAt: la conversación recién creada que todavía no tiene un
  // solo mensaje. Es el caso que `nulls: "last"` ordena.
  convSinMensajes = await crearConversacion({
    org: orgA,
    agentId: orgA.agentA,
    branchId: orgA.branchA,
    contactId: orgA.contactBruno,
    channel: "WHATSAPP",
  });

  convDeOtraOrg = await crearConversacion({
    org: orgB,
    agentId: orgB.agentA,
    branchId: orgB.branchA,
    contactId: orgB.contactAna,
    channel: "WHATSAPP",
    lastMessageAt: new Date("2026-03-04T10:00:00.000Z"),
  });

  // El hilo de la conversación derivada: entrante del contacto, saliente del
  // agente con auditoría de tools, y la respuesta de una persona después del
  // handoff. Los createdAt van explícitos para poder afirmar el orden.
  await prisma.message.createMany({
    data: [
      {
        organizationId: orgA.id,
        conversationId: convWhatsappAna,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Hola, quiero saber el precio del Corolla",
        createdAt: new Date("2026-03-03T09:58:00.000Z"),
      },
      {
        organizationId: orgA.id,
        conversationId: convWhatsappAna,
        direction: "OUTBOUND",
        senderType: "AGENT",
        content: "Te paso el precio en un momento",
        toolCalls: [
          { id: "call-1", name: "create_opportunity", arguments: { amount: 1000 }, allowed: true },
        ],
        createdAt: new Date("2026-03-03T09:59:00.000Z"),
      },
      {
        organizationId: orgA.id,
        conversationId: convWhatsappAna,
        direction: "OUTBOUND",
        senderType: "HUMAN",
        senderUserId: adminA.userId,
        content: "Hola Ana, sigo yo desde acá",
        createdAt: new Date("2026-03-03T10:00:00.000Z"),
      },
    ],
  });
});

after(async () => {
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.message.deleteMany({ where: { organizationId: org.id } });
    await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
    await prisma.agent.deleteMany({ where: { organizationId: org.id } });
    await prisma.contact.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
  for (const u of [adminA, userA, adminB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Permisos: la diferencia con el resto del módulo de agentes
// ---------------------------------------------------------------------------

test("un USER autenticado LEE la bandeja: no hace falta ser ADMIN", async () => {
  // Lo opuesto de lo que testean Agent/KB/Automation en sus rutas de
  // escritura. Acá no hay ninguna escritura que gatear: es un dato del CRM,
  // como los contactos o el stock.
  const { data } = await listar(userA.accessToken);
  assert.ok(data.length > 0, "el USER tiene que ver las conversaciones de su organización");
});

test("un USER autenticado abre el detalle de una conversación", async () => {
  const res = await call("GET", `/api/conversations/${convWhatsappAna}`, userA.accessToken);
  assert.equal(res.status, 200);
});

test("sin token, las dos rutas son 401", async () => {
  for (const path of ["/api/conversations", `/api/conversations/${convWhatsappAna}`]) {
    const res = await call("GET", path);
    assert.equal(res.status, 401, `${path} debería exigir sesión`);
  }
});

// ---------------------------------------------------------------------------
// Aislamiento multi-tenant
// ---------------------------------------------------------------------------

test("la conversación de otra organización NO aparece en el listado", async () => {
  const { data } = await listar(adminA.accessToken);
  assert.equal(ids(data).includes(convDeOtraOrg), false);

  // Y al revés, para que el test no pase por estar mirando una lista vacía.
  const { data: deB } = await listar(adminB.accessToken);
  assert.deepEqual(ids(deB), [convDeOtraOrg]);
});

test("abrir por id una conversación de otra organización da 404, no 403", async () => {
  const res = await call("GET", `/api/conversations/${convDeOtraOrg}`, adminA.accessToken);
  assert.equal(res.status, 404);
  assert.match(await mensajeDeError(res), /Conversación no encontrada/);
});

test("un id que no existe también da 404, y uno que no es UUID da 400", async () => {
  const inexistente = await call("GET", `/api/conversations/${randomUUID()}`, adminA.accessToken);
  assert.equal(inexistente.status, 404);

  const malFormado = await call("GET", "/api/conversations/no-es-uuid", adminA.accessToken);
  assert.equal(malFormado.status, 400);
  assert.match(await mensajeDeError(malFormado), /id inválido/);
});

// ---------------------------------------------------------------------------
// La forma de una fila
// ---------------------------------------------------------------------------

test("cada fila trae el contacto, el agente y la sucursal resueltos por nombre", async () => {
  const { data } = await listar(adminA.accessToken, `?contactId=${orgA.contactAna}&status=CLOSED`);

  assert.equal(data.length, 1);
  const [fila] = data;
  assert.equal(fila.id, convCerradaAna);
  assert.equal(fila.contact.firstName, "Ana");
  assert.equal(fila.contact.lastName, "Pérez");
  assert.match(fila.agent.name, /^Vera /);
  assert.match(fila.branch.name, /^Centro /);
  assert.equal(fila.channel, "WEB");
  assert.equal(fila.status, "CLOSED");
});

test("una conversación CLOSED se lista igual: es historia, no una fila borrada", async () => {
  const { data } = await listar(adminA.accessToken);
  assert.ok(ids(data).includes(convCerradaAna));
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

test("filtro por estado", async () => {
  const { data } = await listar(adminA.accessToken, "?status=TRANSFERRED_TO_HUMAN");
  assert.deepEqual(ids(data), [convWhatsappAna]);
});

test("filtro por canal", async () => {
  const { data } = await listar(adminA.accessToken, "?channel=WEB");
  assert.deepEqual(ids(data).sort(), [convWebBruno, convCerradaAna].sort());
});

test("filtro por sucursal", async () => {
  const { data } = await listar(adminA.accessToken, `?branchId=${orgA.branchB}`);
  assert.deepEqual(ids(data), [convWebBruno]);
});

test("filtro por agente", async () => {
  const { data } = await listar(adminA.accessToken, `?agentId=${orgA.agentB}`);
  assert.deepEqual(ids(data), [convWebBruno]);
});

test("filtro por contacto", async () => {
  const { data } = await listar(adminA.accessToken, `?contactId=${orgA.contactBruno}`);
  assert.deepEqual(ids(data).sort(), [convWebBruno, convSinMensajes].sort());
});

test("dos filtros a la vez se combinan con AND", async () => {
  const { data } = await listar(
    adminA.accessToken,
    `?contactId=${orgA.contactAna}&channel=WHATSAPP`,
  );
  assert.deepEqual(ids(data), [convWhatsappAna]);
});

test("la búsqueda es por el contacto: nombre, apellido o email, sin distinguir mayúsculas", async () => {
  // El tercero es el email completo: el OR cubre los tres campos, y el email
  // es lo que alguien pega cuando lo tiene a mano.
  for (const termino of ["ana", "PÉREZ", orgA.contactAnaEmail]) {
    const { data } = await listar(adminA.accessToken, `?search=${encodeURIComponent(termino)}`);
    assert.deepEqual(
      ids(data).sort(),
      [convWhatsappAna, convCerradaAna].sort(),
      `la búsqueda "${termino}" no trajo las conversaciones de Ana`,
    );
  }

  const porApellidoDelOtro = await listar(adminA.accessToken, "?search=gim");
  assert.deepEqual(ids(porApellidoDelOtro.data).sort(), [convWebBruno, convSinMensajes].sort());
});

test("la búsqueda NO mira el contenido de los mensajes", async () => {
  // "Corolla" está en un Message de la conversación de Ana, y aun así no
  // matchea: el buscador es por contacto, a propósito.
  const { data } = await listar(adminA.accessToken, "?search=Corolla");
  assert.deepEqual(data, []);
});

test("un filtro con un valor fuera del enum es 400 y no una lista vacía", async () => {
  const res = await call("GET", "/api/conversations?status=PENDIENTE", adminA.accessToken);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Orden y paginación
// ---------------------------------------------------------------------------

test("por defecto: la del último mensaje primero, y la que no tiene mensajes al final", async () => {
  const { data } = await listar(adminA.accessToken);
  assert.deepEqual(ids(data), [convWhatsappAna, convWebBruno, convCerradaAna, convSinMensajes]);
});

test("sortOrder=asc invierte, y la que no tiene mensajes sigue al final", async () => {
  const { data } = await listar(adminA.accessToken, "?sortOrder=asc");
  // nulls: "last" no depende del sentido del orden: una conversación sin
  // mensajes no encabeza la bandeja en ninguno de los dos.
  assert.deepEqual(ids(data), [convCerradaAna, convWebBruno, convWhatsappAna, convSinMensajes]);
});

test("la paginación parte la lista y el total cuenta todas", async () => {
  const primera = await listar(adminA.accessToken, "?pageSize=2");
  assert.deepEqual(primera.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 });
  assert.deepEqual(ids(primera.data), [convWhatsappAna, convWebBruno]);

  const segunda = await listar(adminA.accessToken, "?pageSize=2&page=2");
  assert.equal(segunda.pagination.page, 2);
  assert.deepEqual(ids(segunda.data), [convCerradaAna, convSinMensajes]);
});

test("el total respeta los filtros, no cuenta todas las de la organización", async () => {
  const { pagination } = await listar(adminA.accessToken, "?channel=WEB");
  assert.equal(pagination.total, 2);
});

// ---------------------------------------------------------------------------
// El detalle
// ---------------------------------------------------------------------------

interface Detalle extends Fila {
  messages: {
    id: string;
    direction: string;
    senderType: string;
    senderUserId: string | null;
    content: string;
    toolCalls: unknown;
    createdAt: string;
    senderUser: { id: string; fullName: string } | null;
  }[];
}

async function detalle(id: string, token: string): Promise<Detalle> {
  const res = await call("GET", `/api/conversations/${id}`, token);
  const crudo = await res.text();
  assert.equal(res.status, 200, `no se pudo abrir la conversación: ${crudo}`);
  return JSON.parse(crudo) as Detalle;
}

test("el detalle trae el hilo completo en orden cronológico", async () => {
  const conversacion = await detalle(convWhatsappAna, adminA.accessToken);

  assert.equal(conversacion.messages.length, 3);
  assert.deepEqual(
    conversacion.messages.map((m) => m.senderType),
    ["CONTACT", "AGENT", "HUMAN"],
  );
  assert.deepEqual(
    conversacion.messages.map((m) => m.direction),
    ["INBOUND", "OUTBOUND", "OUTBOUND"],
  );
  assert.equal(conversacion.messages[0].content, "Hola, quiero saber el precio del Corolla");
});

test("el mensaje de una persona dice QUIÉN contestó; los del agente y el contacto, no", async () => {
  const conversacion = await detalle(convWhatsappAna, adminA.accessToken);
  const [delContacto, delAgente, delHumano] = conversacion.messages;

  assert.equal(delContacto.senderUser, null);
  assert.equal(delAgente.senderUser, null);
  assert.equal(delHumano.senderUser?.id, adminA.userId);
  assert.equal(delHumano.senderUser?.fullName, "Conv Test admin-a");
});

test("toolCalls viaja tal cual se persistió, sin proyectar nada", async () => {
  const conversacion = await detalle(convWhatsappAna, adminA.accessToken);
  const delAgente = conversacion.messages[1];

  assert.deepEqual(delAgente.toolCalls, [
    { id: "call-1", name: "create_opportunity", arguments: { amount: 1000 }, allowed: true },
  ]);
  // El del contacto no tiene ninguna: es NULL en la base y llega como null.
  assert.equal(conversacion.messages[0].toolCalls, null);
});

test("una conversación sin mensajes se abre igual, con el hilo vacío", async () => {
  const conversacion = await detalle(convSinMensajes, adminA.accessToken);

  assert.deepEqual(conversacion.messages, []);
  assert.equal(conversacion.lastMessageAt, null);
  // Y las relaciones de cabecera siguen estando: la pantalla puede mostrar de
  // quién es la conversación aunque no haya nada escrito todavía.
  assert.equal(conversacion.contact.firstName, "Bruno");
});

test("el detalle también resuelve contacto, agente y sucursal por nombre", async () => {
  const conversacion = await detalle(convWhatsappAna, adminA.accessToken);

  assert.equal(conversacion.contact.id, orgA.contactAna);
  assert.equal(conversacion.agent.id, orgA.agentA);
  assert.equal(conversacion.branch.id, orgA.branchA);
  assert.match(conversacion.branch.name, /^Centro /);
});
