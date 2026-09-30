import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import type { InternalAgentMessage } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { MENSAJE_SIN_ACCESO_AL_AGENTE_INTERNO } from "../middlewares/requireInternalAgentAccess";
import { findRoleByName } from "../repositories/role.repository";
import { internalAgentRouter } from "../routes/internalAgent.routes";
import { userRouter } from "../routes/user.routes";
import { MENSAJE_SIN_AGENTE_INTERNO } from "./internalAgentOrchestration.service";
import {
  CATALOGO_DE_TOOLS_INTERNAS,
  MENSAJE_TAREA_SIN_VINCULO,
} from "./internalAgentTools.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Ítem 179: el agente de IA interno por HTTP real contra Postgres y GoTrue
// reales — la app monta internalAgentRouter (con authenticate, el rate
// limiter y requireInternalAgentAccess) y userRouter (el PATCH que habilita a
// un USER), + notFound + errorHandler. El LLM es un doble guionado instalado
// con setLlmProviderForTests, mismo seam que los tests del test-message.
//
// Lo que se fija acá y no se puede fijar sin base:
//
//   1. Acceso: ADMIN siempre pasa; USER sin canUseInternalAgent recibe 403;
//      el ADMIN lo habilita por PATCH /users/:id y desde ahí pasa. La
//      configuración es solo ADMIN.
//   2. Aislamiento del historial: entre organizaciones y entre usuarios de la
//      misma organización (el hilo es por usuario).
//   3. create_internal_task: resuelve por texto dentro de la organización,
//      crea la Activity (TASK, autor y asignada a quien pidió) y nunca intenta
//      una tarea sin vínculo — el CHECK de activities sigue ahí para frenarla.
//   4. get_agenda: solo los turnos de la organización, filtrables por
//      sucursal, con la hora en la zona de cada sucursal.
// ---------------------------------------------------------------------------

const PASSWORD = "InternalAgent-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

interface Negocio {
  organizationId: string;
  branchCentroId: string;
  branchNorteId: string;
  contactId: string;
  opportunityId: string;
}

let baseUrl: string;
let closeApp: () => Promise<void>;
let orgA: string;
let orgB: string;
let adminA: FixtureUser;
let userA: FixtureUser; // USER sin acceso de entrada
let otroUserA: FixtureUser; // USER con acceso desde el alta
let adminB: FixtureUser;
let a: Negocio;
let b: Negocio;
const fixtureUsers: FixtureUser[] = [];

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", internalAgentRouter);
  app.use("/api", userRouter);
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

async function crearOrganizacion(etiqueta: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `Agente interno ${etiqueta} ${randomUUID()}`,
      slug: `agente-interno-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      timezone: "America/Montevideo",
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
  canUseInternalAgent = false,
): Promise<FixtureUser> {
  const email = `agente-interno-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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

  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Agente Interno ${label}`,
      canUseInternalAgent,
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

  const user = { accessToken: signInData.session.access_token, authUserId: data.user.id };
  fixtureUsers.push(user);
  return user;
}

// Dos sucursales en zonas distintas, un contacto con una oportunidad y un
// turno en cada sucursal. Por Prisma directo: lo que se prueba es el agente,
// no esos services.
async function montarNegocio(
  organizationId: string,
  ownerId: string,
  nombreContacto: { firstName: string; lastName: string },
  tituloOportunidad: string,
  diaDeLosTurnos: Date,
): Promise<Negocio> {
  const centro = await prisma.branch.create({
    data: { organizationId, name: "Casa Central", timezone: "America/Montevideo" },
  });
  const norte = await prisma.branch.create({
    data: { organizationId, name: "Sucursal Norte", timezone: "America/Mexico_City" },
  });
  const contacto = await prisma.contact.create({ data: { organizationId, ...nombreContacto } });
  const pipeline = await prisma.pipeline.create({ data: { organizationId, name: "Ventas" } });
  const stage = await prisma.stage.create({
    data: { organizationId, pipelineId: pipeline.id, name: "Nueva", order: 1 },
  });
  const oportunidad = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId: contacto.id,
      ownerId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: tituloOportunidad,
    },
  });

  for (const [branch, hora] of [
    [centro, 13],
    [norte, 16],
  ] as const) {
    const resource = await prisma.resource.create({
      data: { organizationId, branchId: branch.id, name: `Box ${branch.name}`, type: "ROOM" },
    });
    const servicio = await prisma.serviceType.create({
      data: {
        organizationId,
        branchId: branch.id,
        resourceId: resource.id,
        name: `Test drive ${branch.name}`,
        durationMin: 30,
      },
    });
    const inicio = new Date(diaDeLosTurnos);
    inicio.setUTCHours(hora, 0, 0, 0);
    await prisma.booking.create({
      data: {
        organizationId,
        branchId: branch.id,
        serviceTypeId: servicio.id,
        resourceId: resource.id,
        contactId: contacto.id,
        startsAt: inicio,
        endsAt: new Date(inicio.getTime() + 30 * 60 * 1000),
      },
    });
  }

  return {
    organizationId,
    branchCentroId: centro.id,
    branchNorteId: norte.id,
    contactId: contacto.id,
    opportunityId: oportunidad.id,
  };
}

// ---------------------------------------------------------------------------
// El doble del LLM
// ---------------------------------------------------------------------------

let requestsAlLlm: LlmCompletionRequest[] = [];

function guionar(guion: LlmCompletionResult[]) {
  requestsAlLlm = [];
  setLlmProviderForTests({
    name: "doble",
    complete(request) {
      requestsAlLlm.push(request);
      return Promise.resolve(guion[Math.min(requestsAlLlm.length - 1, guion.length - 1)]);
    },
  });
}

const texto = (t: string): LlmCompletionResult => ({ text: t, toolCalls: [] });

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function pedir(method: string, path: string, token: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function escribir(token: string, content: string) {
  return pedir("POST", "/api/internal-agent/messages", token, { content });
}

async function historial(token: string): Promise<InternalAgentMessage[]> {
  const res = await pedir("GET", "/api/internal-agent/messages?pageSize=100", token);
  assert.equal(res.status, 200);
  return ((await res.json()) as { data: InternalAgentMessage[] }).data;
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

function configurar(
  token: string,
  enabledTools: string[] = [...CATALOGO_DE_TOOLS_INTERNAS.keys()],
) {
  return pedir("PUT", "/api/internal-agent", token, {
    name: "Asistente interno",
    instructions: "Sos el asistente del equipo.",
    enabledTools,
  });
}

const DIA_DE_LOS_TURNOS = new Date("2026-11-10T00:00:00.000Z");

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  adminA = await createFixtureUser("admin-a", orgA, "ADMIN");
  userA = await createFixtureUser("user-a", orgA, "USER");
  otroUserA = await createFixtureUser("otro-user-a", orgA, "USER", true);
  adminB = await createFixtureUser("admin-b", orgB, "ADMIN");

  a = await montarNegocio(
    orgA,
    adminA.authUserId,
    { firstName: "Ana", lastName: "Suárez" },
    "Hilux SRV 2024",
    DIA_DE_LOS_TURNOS,
  );
  b = await montarNegocio(
    orgB,
    adminB.authUserId,
    { firstName: "Bruno", lastName: "Otero" },
    "Amarok V6",
    DIA_DE_LOS_TURNOS,
  );
});

afterEach(() => {
  resetLlmProviderParaTests();
});

after(async () => {
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.internalAgentMessage.deleteMany({ where: { organizationId: org } });
    await prisma.internalAgent.deleteMany({ where: { organizationId: org } });
    await prisma.activity.deleteMany({ where: { organizationId: org } });
    await prisma.booking.deleteMany({ where: { organizationId: org } });
    await prisma.serviceType.deleteMany({ where: { organizationId: org } });
    await prisma.resource.deleteMany({ where: { organizationId: org } });
    await prisma.opportunity.deleteMany({ where: { organizationId: org } });
    await prisma.contact.deleteMany({ where: { organizationId: org } });
    await prisma.stage.deleteMany({ where: { organizationId: org } });
    await prisma.pipeline.deleteMany({ where: { organizationId: org } });
    await prisma.branch.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of fixtureUsers) {
    await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Configuración y acceso. Los tests de este archivo corren en orden: el
// primero ve la organización todavía sin agente.
// ---------------------------------------------------------------------------

test("sin agente configurado: el chat responde 404 con el mensaje claro y no guarda nada", async () => {
  guionar([texto("no debería llamarse")]);
  const res = await escribir(adminA.accessToken, "hola");
  assert.equal(res.status, 404);
  assert.equal(await mensajeDeError(res), MENSAJE_SIN_AGENTE_INTERNO);
  assert.equal(await prisma.internalAgentMessage.count({ where: { organizationId: orgA } }), 0);
  assert.equal(requestsAlLlm.length, 0);

  const get = await pedir("GET", "/api/internal-agent", adminA.accessToken);
  assert.equal(get.status, 404);
});

test("la configuración es solo ADMIN: un USER —aun habilitado— recibe 403 en GET y PUT", async () => {
  for (const token of [userA.accessToken, otroUserA.accessToken]) {
    assert.equal((await configurar(token)).status, 403);
    assert.equal((await pedir("GET", "/api/internal-agent", token)).status, 403);
  }
  assert.equal(await prisma.internalAgent.count({ where: { organizationId: orgA } }), 0);
});

test("PUT crea el agente la primera vez y lo reemplaza después (upsert por organización)", async () => {
  const primero = await configurar(adminA.accessToken, ["get_agenda"]);
  assert.equal(primero.status, 200);
  const creado = (await primero.json()) as { id: string; enabledTools: string[] };
  assert.deepEqual(creado.enabledTools, ["get_agenda"]);

  const segundo = await configurar(adminA.accessToken);
  assert.equal(segundo.status, 200);
  const reemplazado = (await segundo.json()) as {
    id: string;
    enabledTools: string[];
    modelProvider: string;
  };
  assert.equal(reemplazado.id, creado.id, "es el mismo registro, no uno nuevo");
  assert.deepEqual(reemplazado.enabledTools.sort(), ["create_internal_task", "get_agenda"]);
  assert.equal(reemplazado.modelProvider, "openrouter");
  assert.equal(await prisma.internalAgent.count({ where: { organizationId: orgA } }), 1);

  const get = await pedir("GET", "/api/internal-agent", adminA.accessToken);
  assert.equal(get.status, 200);
  assert.equal(((await get.json()) as { id: string }).id, creado.id);
});

// B-05 (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): el modelo
// lo elige la plataforma. El agente interno nace con OPENROUTER_MODEL y el
// ADMIN no lo cambia; lo cambia un platform admin (probado en
// agent.controller.integration-test.ts).
test("B-05 — PUT con un modelo distinto del vigente es 403 y no toca nada; con el mismo, 200", async () => {
  assert.equal((await configurar(adminA.accessToken)).status, 200);
  const vigente = await prisma.internalAgent.findUniqueOrThrow({ where: { organizationId: orgA } });
  assert.equal(vigente.modelName, env.OPENROUTER_MODEL);

  const otro = await pedir("PUT", "/api/internal-agent", adminA.accessToken, {
    name: "Otro nombre",
    instructions: "Otras instrucciones",
    modelName: "openai/o1-pro",
  });
  assert.equal(otro.status, 403);
  const despues = await prisma.internalAgent.findUniqueOrThrow({ where: { organizationId: orgA } });
  assert.equal(despues.modelName, env.OPENROUTER_MODEL);
  assert.equal(despues.name, vigente.name, "el resto del PUT tampoco se aplicó");

  const mismo = await pedir("PUT", "/api/internal-agent", adminA.accessToken, {
    name: "Asistente interno",
    instructions: "Sos el asistente del equipo.",
    modelName: env.OPENROUTER_MODEL,
    enabledTools: [...CATALOGO_DE_TOOLS_INTERNAS.keys()],
  });
  assert.equal(mismo.status, 200);
});

test("PUT valida el body: sin instructions o con un proveedor inexistente -> 400", async () => {
  const sinInstructions = await pedir("PUT", "/api/internal-agent", adminA.accessToken, {
    name: "X",
  });
  assert.equal(sinInstructions.status, 400);
  const proveedor = await pedir("PUT", "/api/internal-agent", adminA.accessToken, {
    name: "X",
    instructions: "Y",
    modelProvider: "no-existe",
  });
  assert.equal(proveedor.status, 400);
});

test("un USER sin canUseInternalAgent recibe 403 en el chat y no se guarda nada", async () => {
  guionar([texto("no debería llamarse")]);
  const post = await escribir(userA.accessToken, "hola");
  assert.equal(post.status, 403);
  assert.equal(await mensajeDeError(post), MENSAJE_SIN_ACCESO_AL_AGENTE_INTERNO);
  const get = await pedir("GET", "/api/internal-agent/messages", userA.accessToken);
  assert.equal(get.status, 403);

  assert.equal(await prisma.internalAgentMessage.count({ where: { userId: userA.authUserId } }), 0);
  assert.equal(requestsAlLlm.length, 0);
});

test("el ADMIN siempre pasa, aunque su columna canUseInternalAgent esté en false", async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminA.authUserId } });
  assert.equal(admin.canUseInternalAgent, false);

  guionar([texto("Hola, ¿en qué te ayudo?")]);
  const res = await escribir(adminA.accessToken, "hola");
  assert.equal(res.status, 200);
  const mensaje = (await res.json()) as InternalAgentMessage;
  assert.equal(mensaje.senderType, "AGENT");
  assert.equal(mensaje.content, "Hola, ¿en qué te ayudo?");
  assert.equal(mensaje.userId, adminA.authUserId);

  // El prompt lleva la persona y la referencia temporal de la organización.
  assert.match(requestsAlLlm[0].systemPrompt, /se llama Agente Interno admin-a/);
  assert.match(requestsAlLlm[0].systemPrompt, /America\/Montevideo/);
});

test("el ADMIN habilita a un USER por PATCH /users/:id y desde ahí el USER pasa", async () => {
  const patch = await pedir("PATCH", `/api/users/${userA.authUserId}`, adminA.accessToken, {
    canUseInternalAgent: true,
  });
  assert.equal(patch.status, 200);
  assert.equal(
    ((await patch.json()) as { canUseInternalAgent: boolean }).canUseInternalAgent,
    true,
  );

  guionar([texto("Hola")]);
  assert.equal((await escribir(userA.accessToken, "hola")).status, 200);

  // El historial trae el nombre del agente (ítem 180): el USER no puede leer
  // la configuración, y el chat lo muestra en su encabezado.
  const get = await pedir("GET", "/api/internal-agent/messages", userA.accessToken);
  assert.equal(get.status, 200);
  assert.equal(((await get.json()) as { agentName: string }).agentName, "Asistente interno");

  // Y se lo puede volver a sacar.
  const quitar = await pedir("PATCH", `/api/users/${userA.authUserId}`, adminA.accessToken, {
    canUseInternalAgent: false,
  });
  assert.equal(quitar.status, 200);
  assert.equal((await escribir(userA.accessToken, "hola")).status, 403);
});

test("un USER no puede habilitarse a sí mismo: el PATCH de usuarios es ADMIN-only", async () => {
  const res = await pedir("PATCH", `/api/users/${userA.authUserId}`, userA.accessToken, {
    canUseInternalAgent: true,
  });
  assert.equal(res.status, 403);
});

test("POST valida el content: vacío o ausente -> 400", async () => {
  assert.equal((await escribir(adminA.accessToken, "   ")).status, 400);
  const sinContent = await pedir("POST", "/api/internal-agent/messages", adminA.accessToken, {});
  assert.equal(sinContent.status, 400);
});

// ---------------------------------------------------------------------------
// Aislamiento del historial
// ---------------------------------------------------------------------------

test("el historial es por usuario: cada uno ve solo su hilo, ordenado de lo más nuevo a lo más viejo", async () => {
  guionar([texto("respuesta para el otro user")]);
  assert.equal((await escribir(otroUserA.accessToken, "mensaje del otro user")).status, 200);

  const delOtro = await historial(otroUserA.accessToken);
  assert.deepEqual(
    delOtro.map((m) => [m.senderType, m.content]),
    [
      ["AGENT", "respuesta para el otro user"],
      ["USER", "mensaje del otro user"],
    ],
  );
  assert.ok(delOtro.every((m) => m.userId === otroUserA.authUserId));

  const delAdmin = await historial(adminA.accessToken);
  assert.ok(delAdmin.length > 0);
  assert.ok(delAdmin.every((m) => m.userId === adminA.authUserId));
  assert.ok(!delAdmin.some((m) => m.content.includes("otro user")));
});

test("la ventana del modelo es el hilo de quien escribe, no el de otro usuario", async () => {
  guionar([texto("ok")]);
  assert.equal((await escribir(otroUserA.accessToken, "segundo mensaje")).status, 200);
  const contenidos = requestsAlLlm[0].messages.map((m) => ("content" in m ? m.content : null));
  assert.deepEqual(contenidos, [
    "mensaje del otro user",
    "respuesta para el otro user",
    "segundo mensaje",
  ]);
});

test("entre organizaciones: B tiene su propio agente e hilo, y no ve nada de A", async () => {
  // Sin agente en B, el hilo de B no existe todavía.
  assert.equal(
    (await pedir("GET", "/api/internal-agent/messages", adminB.accessToken)).status,
    404,
  );
  assert.equal((await pedir("GET", "/api/internal-agent", adminB.accessToken)).status, 404);

  assert.equal((await configurar(adminB.accessToken)).status, 200);
  const agenteA = await prisma.internalAgent.findUniqueOrThrow({ where: { organizationId: orgA } });
  const agenteB = await prisma.internalAgent.findUniqueOrThrow({ where: { organizationId: orgB } });
  assert.notEqual(agenteA.id, agenteB.id);

  guionar([texto("hola B")]);
  assert.equal((await escribir(adminB.accessToken, "hola desde B")).status, 200);

  const deB = await historial(adminB.accessToken);
  assert.deepEqual(
    deB.map((m) => m.content),
    ["hola B", "hola desde B"],
  );
  assert.ok(deB.every((m) => m.organizationId === orgB && m.internalAgentId === agenteB.id));
  assert.ok(!(await historial(adminA.accessToken)).some((m) => m.organizationId === orgB));
});

test("la FK compuesta impide colgar un mensaje de A del agente de B", async () => {
  const agenteB = await prisma.internalAgent.findUniqueOrThrow({ where: { organizationId: orgB } });
  await assert.rejects(
    prisma.internalAgentMessage.create({
      data: {
        organizationId: orgA,
        internalAgentId: agenteB.id,
        userId: adminA.authUserId,
        senderType: "USER",
        content: "cruzado",
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// create_internal_task
// ---------------------------------------------------------------------------

function crearTarea(
  organizationId: string,
  userId: string,
  args: Record<string, unknown>,
  role: "ADMIN" | "USER" = "ADMIN",
) {
  return CATALOGO_DE_TOOLS_INTERNAS.get("create_internal_task")!.ejecutar(args, {
    organizationId,
    userId,
    role,
  });
}

test("create_internal_task por nombre y apellido: TASK ligada al contacto, autor y asignada a quien pidió", async () => {
  const resultado = await crearTarea(orgA, adminA.authUserId, {
    asunto: "Llamar para confirmar la seña",
    contacto: "ana suárez",
    fechaLimite: "2026-11-12T09:00:00-03:00",
    descripcion: "Pidió que sea a la mañana",
  });
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  const data = (
    resultado as { data: { activityId: string; contacto: string; fechaLimite: string } }
  ).data;
  assert.equal(data.contacto, "Ana Suárez");
  assert.equal(data.fechaLimite, "2026-11-12T09:00:00-03:00");

  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: data.activityId } });
  assert.equal(fila.organizationId, orgA);
  assert.equal(fila.type, "TASK");
  assert.equal(fila.subject, "Llamar para confirmar la seña");
  assert.equal(fila.body, "Pidió que sea a la mañana");
  assert.equal(fila.contactId, a.contactId);
  assert.equal(fila.opportunityId, null);
  assert.equal(fila.authorId, adminA.authUserId);
  assert.equal(fila.assigneeId, adminA.authUserId);
  assert.equal(fila.dueDate?.toISOString(), "2026-11-12T12:00:00.000Z");
});

// B-18: la tool pasa por la MISMA regla que POST /api/activities
// (createActivityAsActor). Un USER crea la tarea asignada a sí mismo — lo
// único que esta tool pide —, igual que desde el panel.
test("B-18 create_internal_task pedida por un USER: TASK autor y asignada a ese USER", async () => {
  const resultado = await crearTarea(
    orgA,
    otroUserA.authUserId,
    { asunto: "Seguimiento del vendedor", contacto: "ana suárez" },
    "USER",
  );
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  const { activityId } = (resultado as { data: { activityId: string } }).data;
  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
  assert.equal(fila.authorId, otroUserA.authUserId);
  assert.equal(fila.assigneeId, otroUserA.authUserId);
  assert.equal(fila.contactId, a.contactId);
});

test("create_internal_task solo con la oportunidad: la liga a la oportunidad", async () => {
  const resultado = await crearTarea(orgA, adminA.authUserId, {
    asunto: "Mandar presupuesto",
    oportunidad: "Hilux SRV",
  });
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  const { activityId } = (resultado as { data: { activityId: string } }).data;
  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
  assert.equal(fila.opportunityId, a.opportunityId);
  assert.equal(fila.contactId, null);
});

test("create_internal_task sin nada resoluble: error legible, y no se crea ninguna Activity", async () => {
  const antes = await prisma.activity.count({ where: { organizationId: orgA } });

  const sinVinculo = await crearTarea(orgA, adminA.authUserId, { asunto: "Algo" });
  assert.deepEqual(sinVinculo, { ok: false, error: MENSAJE_TAREA_SIN_VINCULO });

  const inexistente = await crearTarea(orgA, adminA.authUserId, {
    asunto: "Algo",
    contacto: "Nadie Inventado",
  });
  assert.equal(inexistente.ok, false);
  assert.match((inexistente as { error: string }).error, /No encontré ningún contacto/);

  assert.equal(await prisma.activity.count({ where: { organizationId: orgA } }), antes);
});

test("create_internal_task no encuentra contactos ni oportunidades de otra organización", async () => {
  const contactoDeB = await crearTarea(orgA, adminA.authUserId, {
    asunto: "Algo",
    contacto: "Bruno Otero",
  });
  assert.equal(contactoDeB.ok, false);
  const oportunidadDeB = await crearTarea(orgA, adminA.authUserId, {
    asunto: "Algo",
    oportunidad: "Amarok",
  });
  assert.equal(oportunidadDeB.ok, false);
  assert.equal(
    await prisma.activity.count({
      where: { OR: [{ contactId: b.contactId }, { opportunityId: b.opportunityId }] },
    }),
    0,
  );
});

test("create_internal_task: un nombre que coincide con varios contactos pide cuál, nombrándolos", async () => {
  const segunda = await prisma.contact.create({
    data: { organizationId: orgA, firstName: "Ana", lastName: "Pereira" },
  });
  try {
    const resultado = await crearTarea(orgA, adminA.authUserId, {
      asunto: "Algo",
      contacto: "Ana",
    });
    assert.equal(resultado.ok, false);
    const { error } = resultado as { error: string };
    assert.match(error, /más de un contacto/);
    assert.match(error, /Ana Suárez/);
    assert.match(error, /Ana Pereira/);
  } finally {
    await prisma.contact.delete({ where: { id: segunda.id } });
  }
});

test("el CHECK de activities sigue frenando una tarea sin vínculo aunque alguien se saltee la tool", async () => {
  await assert.rejects(
    prisma.activity.create({
      data: { organizationId: orgA, type: "TASK", authorId: adminA.authUserId, subject: "Suelta" },
    }),
    /activities_.*check|check constraint/i,
  );
});

test("el loop entero: el modelo pide create_internal_task, se crea la tarea y el mensaje del agente queda auditado", async () => {
  guionar([
    {
      text: null,
      toolCalls: [
        {
          id: "call-1",
          name: "create_internal_task",
          arguments: { asunto: "Seguimiento por HTTP", contacto: "Ana Suárez" },
        },
      ],
    },
    texto("Listo, te creé la tarea."),
  ]);

  const res = await escribir(adminA.accessToken, "Creame una tarea para Ana Suárez");
  assert.equal(res.status, 200);
  const mensaje = (await res.json()) as InternalAgentMessage;
  assert.equal(mensaje.content, "Listo, te creé la tarea.");

  const tarea = await prisma.activity.findFirstOrThrow({
    where: { organizationId: orgA, subject: "Seguimiento por HTTP" },
  });
  assert.equal(tarea.contactId, a.contactId);

  const persistido = await prisma.internalAgentMessage.findUniqueOrThrow({
    where: { id: mensaje.id },
  });
  const toolCalls = persistido.toolCalls as {
    name: string;
    allowed: boolean;
    result: { ok: boolean };
  }[];
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "create_internal_task");
  assert.equal(toolCalls[0].allowed, true);
  assert.equal(toolCalls[0].result.ok, true);
});

// ---------------------------------------------------------------------------
// get_agenda
// ---------------------------------------------------------------------------

interface TurnoResumido {
  fecha: string;
  hora: string;
  contacto: string | null;
  servicio: string | null;
  sucursal: string | null;
  estado: string;
}

async function agenda(organizationId: string, args: Record<string, unknown>) {
  const resultado = await CATALOGO_DE_TOOLS_INTERNAS.get("get_agenda")!.ejecutar(args, {
    organizationId,
    userId: randomUUID(),
    role: "ADMIN",
  });
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  return (resultado as { data: { turnos: TurnoResumido[]; sinResultados?: boolean } }).data;
}

const RANGO_DEL_DIA = {
  desde: "2026-11-10T00:00:00-03:00",
  hasta: "2026-11-11T00:00:00-03:00",
};

test("get_agenda devuelve solo los turnos de la organización, resumidos y en la hora de cada sucursal", async () => {
  const deA = await agenda(orgA, RANGO_DEL_DIA);
  assert.deepEqual(deA.turnos, [
    // 13:00Z en Montevideo (-03:00) son las 10:00.
    {
      fecha: "2026-11-10",
      hora: "10:00",
      contacto: "Ana Suárez",
      servicio: "Test drive Casa Central",
      sucursal: "Casa Central",
      estado: "CONFIRMED",
    },
    // 16:00Z en Ciudad de México (-06:00) son las 10:00.
    {
      fecha: "2026-11-10",
      hora: "10:00",
      contacto: "Ana Suárez",
      servicio: "Test drive Sucursal Norte",
      sucursal: "Sucursal Norte",
      estado: "CONFIRMED",
    },
  ]);
  const todo = JSON.stringify(deA);
  assert.doesNotMatch(todo, /Bruno/);
  // Sin ids ni campos internos.
  assert.doesNotMatch(todo, new RegExp(a.contactId));

  const deB = await agenda(orgB, RANGO_DEL_DIA);
  assert.equal(deB.turnos.length, 2);
  assert.ok(deB.turnos.every((t) => t.contacto === "Bruno Otero"));
});

test("get_agenda filtra por sucursal escrita a mano (una palabra, en minúsculas)", async () => {
  const norte = await agenda(orgA, { ...RANGO_DEL_DIA, sucursal: "norte" });
  assert.deepEqual(
    norte.turnos.map((t) => t.sucursal),
    ["Sucursal Norte"],
  );

  const inexistente = await CATALOGO_DE_TOOLS_INTERNAS.get("get_agenda")!.ejecutar(
    { ...RANGO_DEL_DIA, sucursal: "Sur" },
    { organizationId: orgA, userId: randomUUID(), role: "ADMIN" },
  );
  assert.equal(inexistente.ok, false);
  assert.match((inexistente as { error: string }).error, /"Casa Central", "Sucursal Norte"/);
});

test("get_agenda sin turnos en el rango lo dice explícitamente", async () => {
  const vacia = await agenda(orgA, {
    desde: "2026-12-01T00:00:00-03:00",
    hasta: "2026-12-02T00:00:00-03:00",
  });
  assert.deepEqual(vacia.turnos, []);
  assert.equal(vacia.sinResultados, true);
});
