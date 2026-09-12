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
import { agentRouter } from "../routes/agent.routes";
import { MENSAJE_DE_HANDOFF } from "../services/agentOrchestration.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "../services/llmProvider.service";

// ---------------------------------------------------------------------------
// CRUD de /api/agents (paso 2a de docs/ai-agent-architecture.md §9) por HTTP
// real contra una app Express real, montando el router real —con su
// authenticate, su authorize y su rate limiter— contra Postgres y GoTrue
// reales. Mismo patrón que organization.controller.integration-test.ts.
//
// Lo que se prueba acá y no se puede probar sin base ni sin la cadena real:
//
//   1. Solo ADMIN escribe: USER recibe 403 en POST/PATCH/DELETE y nada cambia;
//      el GET lo lee cualquiera de la organización.
//   2. Aislamiento multi-tenant: la organización B no ve, no edita y no borra
//      un agente de la A — 404 en los tres, y la fila queda intacta.
//   3. Scoping por sucursal: un branchId de otra organización (o inexistente)
//      es 400 y no se crea nada; el listado filtra por branchId.
//   4. Soft delete: DELETE marca deletedAt, el GET pasa a 404, el listado lo
//      excluye, y la fila sigue en la base.
//
// CADA ORGANIZACIÓN DE ESTE ARCHIVO ES PROPIA. El runner corre los archivos
// de integración en paralelo contra una base compartida; sin aislar por
// organización, dos archivos se pisarían los conteos del listado.
// ---------------------------------------------------------------------------

const PASSWORD = "Agent-test-password-123!";
const TZ = "America/Montevideo";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

interface Organizacion {
  id: string;
  branchId: string;
}

let orgA: Organizacion;
let orgB: Organizacion;
let adminA: FixtureUser;
let userA: FixtureUser;
let adminB: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", agentRouter);
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
      name: `Agents ${etiqueta} ${randomUUID()}`,
      slug: `agents-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: `Sucursal ${etiqueta}`, timezone: TZ },
  });
  return { id: org.id, branchId: branch.id };
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `agents-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Agents Test ${label}`,
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

  return { accessToken: signInData.session.access_token, authUserId: data.user.id };
}

function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// El mínimo que alcanza para un agente funcional: modelProvider/modelName
// salen por default (OpenRouter + OPENROUTER_MODEL), enabledTools/channels en
// []. guardrails es obligatorio aunque sea {} — NOT NULL sin default en el
// schema, a propósito.
function cuerpoMinimo(branchId: string, extra: Record<string, unknown> = {}) {
  return {
    branchId,
    name: "Agente comercial",
    instructions: "Atendé consultas de venta y agendá turnos.",
    guardrails: {},
    ...extra,
  };
}

async function crearAgentePorHttp(
  token: string,
  branchId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await call("POST", "/api/agents", token, cuerpoMinimo(branchId, extra));
  // El body se lee UNA vez: un `${await res.text()}` dentro del mensaje del
  // assert se evalúa aunque el assert pase, y deja el body inutilizable.
  const crudo = await res.text();
  assert.equal(res.status, 201, `no se pudo crear el agente: ${crudo}`);
  return JSON.parse(crudo) as Record<string, unknown>;
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
});

after(async () => {
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.message.deleteMany({ where: { organizationId: org.id } });
    await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
    await prisma.activity.deleteMany({ where: { organizationId: org.id } });
    await prisma.agentEmbedToken.deleteMany({ where: { organizationId: org.id } });
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
// Camino feliz y forma de los datos
// ---------------------------------------------------------------------------

test("POST /api/agents — ADMIN crea con el cuerpo mínimo; proveedor y modelo salen por default", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId);

  assert.equal(agente.organizationId, orgA.id);
  assert.equal(agente.branchId, orgA.branchId);
  assert.equal(agente.name, "Agente comercial");
  assert.equal(agente.goal, null);
  assert.equal(agente.tone, null);
  assert.equal(agente.modelProvider, "openrouter");
  assert.equal(agente.modelName, env.OPENROUTER_MODEL);
  assert.deepEqual(agente.enabledTools, []);
  assert.deepEqual(agente.channels, []);
  assert.deepEqual(agente.guardrails, {});
  assert.deepEqual(agente.allowedOrigins, [], "paso 5a: sin orígenes = widget deshabilitado");
  assert.equal(agente.isActive, true);
  assert.equal(agente.deletedAt, null);
});

test("POST /api/agents — el cuerpo completo se persiste tal cual, con tools y canales deduplicados", async () => {
  const guardrails = {
    temasProhibidos: ["diagnósticos médicos"],
    accionesProhibidas: ["update_opportunity"],
    datosRequeridosAntesDeAccion: { create_booking: ["contactId", "serviceTypeId"] },
  };

  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    goal: "Vender cortes de pelo",
    tone: "cercano",
    modelProvider: "OpenRouter",
    modelName: "anthropic/claude-sonnet-4",
    enabledTools: ["create_opportunity", "get_availability", "create_opportunity"],
    channels: ["WEB", "WHATSAPP", "WEB"],
    guardrails,
    isActive: false,
  });

  assert.equal(agente.goal, "Vender cortes de pelo");
  assert.equal(agente.tone, "cercano");
  // toLowerCase en el schema: "OpenRouter" es el mismo adaptador.
  assert.equal(agente.modelProvider, "openrouter");
  assert.equal(agente.modelName, "anthropic/claude-sonnet-4");
  assert.deepEqual(agente.enabledTools, ["create_opportunity", "get_availability"]);
  assert.deepEqual(agente.channels, ["WEB", "WHATSAPP"]);
  assert.deepEqual(agente.guardrails, guardrails);
  assert.equal(agente.isActive, false);
});

test("POST /api/agents — validación: sin guardrails, proveedor desconocido, tool que no es snake_case, canal inválido", async () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ guardrails: undefined }, /guardrails es requerido/],
    [{ guardrails: null }, /guardrails debe ser un objeto/],
    [{ guardrails: [] }, /guardrails debe ser un objeto/],
    [{ modelProvider: "anthropic" }, /modelProvider debe ser uno de: openrouter/],
    [{ enabledTools: ["Create Opportunity"] }, /snake_case/],
    [{ channels: ["SMS"] }, /channels solo admite WHATSAPP o WEB/],
    [{ instructions: "   " }, /instructions es requerido/],
  ];

  for (const [extra, esperado] of casos) {
    const res = await call(
      "POST",
      "/api/agents",
      adminA.accessToken,
      cuerpoMinimo(orgA.branchId, extra),
    );
    assert.equal(res.status, 400, `debía ser 400 para ${JSON.stringify(extra)}`);
    assert.match(await mensajeDeError(res), esperado);
  }
});

test("GET /api/agents — lista paginada de la organización; USER también puede leer", async () => {
  const res = await call("GET", "/api/agents?pageSize=100", userA.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  };

  const enBase = await prisma.agent.count({ where: { organizationId: orgA.id, deletedAt: null } });
  assert.equal(body.pagination.total, enBase);
  assert.equal(body.data.length, enBase);
  assert.ok(body.data.every((a) => a.organizationId === orgA.id));
});

test("GET /api/agents/:id y PATCH — ADMIN edita; USER lee el resultado", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId);

  const patch = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {
    name: "Agente de turnos",
    goal: null,
    enabledTools: ["get_availability", "create_booking"],
    guardrails: { condicionesDeDerivacion: ["reclamo"] },
    isActive: false,
  });
  const crudoPatch = await patch.text();
  assert.equal(patch.status, 200, crudoPatch);
  const editado = JSON.parse(crudoPatch) as Record<string, unknown>;
  assert.equal(editado.name, "Agente de turnos");
  assert.equal(editado.goal, null);
  assert.deepEqual(editado.enabledTools, ["get_availability", "create_booking"]);
  // Se reemplaza entero, no se mergea.
  assert.deepEqual(editado.guardrails, { condicionesDeDerivacion: ["reclamo"] });
  assert.equal(editado.isActive, false);
  // Lo que no se mandó no cambia.
  assert.equal(editado.instructions, agente.instructions);

  const get = await call("GET", `/api/agents/${agente.id}`, userA.accessToken);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), editado);
});

test("PATCH /api/agents/:id — sin campos es 400, y branchId NO es editable", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId);

  const vacio = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {});
  assert.equal(vacio.status, 400);
  assert.match(await mensajeDeError(vacio), /al menos un campo/);

  // branchId no está en el schema de update: z.object lo descarta y el body
  // queda vacío → el mismo 400. Es lo que convierte "no cambia de sucursal"
  // en un rechazo visible y no en un campo ignorado en silencio.
  const otraSucursal = await prisma.branch.create({
    data: { organizationId: orgA.id, name: "Otra", timezone: TZ },
  });
  const mueve = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {
    branchId: otraSucursal.id,
  });
  assert.equal(mueve.status, 400);

  const fila = await prisma.agent.findUniqueOrThrow({ where: { id: String(agente.id) } });
  assert.equal(fila.branchId, orgA.branchId, "no debe haber cambiado de sucursal");
});

// ---------------------------------------------------------------------------
// 1. Solo ADMIN escribe
// ---------------------------------------------------------------------------

test("USER recibe 403 en POST, PATCH y DELETE, y nada cambia", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId);
  const antes = await prisma.agent.count({ where: { organizationId: orgA.id } });

  const post = await call("POST", "/api/agents", userA.accessToken, cuerpoMinimo(orgA.branchId));
  assert.equal(post.status, 403);

  const patch = await call("PATCH", `/api/agents/${agente.id}`, userA.accessToken, {
    name: "hijacked",
  });
  assert.equal(patch.status, 403);

  const del = await call("DELETE", `/api/agents/${agente.id}`, userA.accessToken);
  assert.equal(del.status, 403);

  const despues = await prisma.agent.count({ where: { organizationId: orgA.id } });
  assert.equal(despues, antes, "USER no debe haber creado nada");
  const fila = await prisma.agent.findUniqueOrThrow({ where: { id: String(agente.id) } });
  assert.equal(fila.name, "Agente comercial");
  assert.equal(fila.deletedAt, null);
});

// ---------------------------------------------------------------------------
// 2. Aislamiento multi-tenant
// ---------------------------------------------------------------------------

test("la organización B no ve, no edita y no borra un agente de la A", async () => {
  const deA = await crearAgentePorHttp(adminA.accessToken, orgA.branchId);

  // No aparece en el listado de B.
  const lista = await call("GET", "/api/agents?pageSize=100", adminB.accessToken);
  assert.equal(lista.status, 200);
  const { data } = (await lista.json()) as { data: Record<string, unknown>[] };
  assert.ok(
    data.every((a) => a.id !== deA.id),
    "el agente de A no debe aparecer en el listado de B",
  );

  // 404 y no 403: B no tiene por qué enterarse de que ese id existe.
  const get = await call("GET", `/api/agents/${deA.id}`, adminB.accessToken);
  assert.equal(get.status, 404);

  const patch = await call("PATCH", `/api/agents/${deA.id}`, adminB.accessToken, {
    name: "hijacked",
  });
  assert.equal(patch.status, 404);

  const del = await call("DELETE", `/api/agents/${deA.id}`, adminB.accessToken);
  assert.equal(del.status, 404);

  const fila = await prisma.agent.findUniqueOrThrow({ where: { id: String(deA.id) } });
  assert.equal(fila.name, "Agente comercial", "B no debe haber editado nada");
  assert.equal(fila.deletedAt, null, "B no debe haber borrado nada");
});

// ---------------------------------------------------------------------------
// 3. Scoping por sucursal
// ---------------------------------------------------------------------------

test("POST con la sucursal de OTRA organización (o inexistente) es 400 y no crea nada", async () => {
  const antes = await prisma.agent.count({ where: { organizationId: orgA.id } });

  const ajena = await call("POST", "/api/agents", adminA.accessToken, cuerpoMinimo(orgB.branchId));
  assert.equal(ajena.status, 400);
  assert.equal(
    await mensajeDeError(ajena),
    "La sucursal indicada no existe o no pertenece a tu organización",
  );

  const inexistente = await call(
    "POST",
    "/api/agents",
    adminA.accessToken,
    cuerpoMinimo(randomUUID()),
  );
  assert.equal(inexistente.status, 400);

  const despues = await prisma.agent.count({ where: { organizationId: orgA.id } });
  assert.equal(despues, antes);
});

test("POST con una sucursal BORRADA de la propia organización es 400", async () => {
  const borrada = await prisma.branch.create({
    data: { organizationId: orgA.id, name: "Cerrada", timezone: TZ, deletedAt: new Date() },
  });

  const res = await call("POST", "/api/agents", adminA.accessToken, cuerpoMinimo(borrada.id));
  assert.equal(res.status, 400);
});

test("GET /api/agents?branchId= filtra por sucursal dentro de la organización", async () => {
  const norte = await prisma.branch.create({
    data: { organizationId: orgA.id, name: "Norte", timezone: TZ },
  });
  const enNorte = await crearAgentePorHttp(adminA.accessToken, norte.id, { name: "Norte 1" });
  await crearAgentePorHttp(adminA.accessToken, orgA.branchId, { name: "Centro extra" });

  const res = await call("GET", `/api/agents?branchId=${norte.id}`, userA.accessToken);
  assert.equal(res.status, 200);
  const { data, pagination } = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { total: number };
  };
  assert.equal(pagination.total, 1);
  assert.equal(data[0].id, enNorte.id);

  // El branchId de otra organización no filtra nada de la nuestra: cero, no
  // un error — es un filtro, no una escritura.
  const ajeno = await call("GET", `/api/agents?branchId=${orgB.branchId}`, userA.accessToken);
  assert.equal(ajeno.status, 200);
  const cuerpoAjeno = (await ajeno.json()) as { pagination: { total: number } };
  assert.equal(cuerpoAjeno.pagination.total, 0);
});

// ---------------------------------------------------------------------------
// 4. Soft delete
// ---------------------------------------------------------------------------

test("DELETE marca deletedAt: el GET pasa a 404, el listado lo excluye, la fila sigue en la base", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, { name: "Efímero" });

  const del = await call("DELETE", `/api/agents/${agente.id}`, adminA.accessToken);
  assert.equal(del.status, 204);

  const get = await call("GET", `/api/agents/${agente.id}`, adminA.accessToken);
  assert.equal(get.status, 404);

  const lista = await call("GET", "/api/agents?pageSize=100", adminA.accessToken);
  const { data } = (await lista.json()) as { data: Record<string, unknown>[] };
  assert.ok(
    data.every((a) => a.id !== agente.id),
    "el borrado no debe listarse",
  );

  const fila = await prisma.agent.findUniqueOrThrow({ where: { id: String(agente.id) } });
  assert.notEqual(fila.deletedAt, null, "soft delete, no borrado físico");

  // Borrar dos veces es 404: el segundo DELETE no encuentra nada vivo. Y un
  // PATCH sobre un borrado también — updateMany exige deletedAt: null.
  const otraVez = await call("DELETE", `/api/agents/${agente.id}`, adminA.accessToken);
  assert.equal(otraVez.status, 404);
  const patch = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {
    name: "revivido",
  });
  assert.equal(patch.status, 404);
});

test("GET /api/agents?isActive=false lista solo los desactivados (que no es lo mismo que borrados)", async () => {
  const inactivo = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    name: "Apagado",
    isActive: false,
  });

  const res = await call("GET", "/api/agents?isActive=false&pageSize=100", userA.accessToken);
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as { data: Record<string, unknown>[] };
  assert.ok(data.some((a) => a.id === inactivo.id));
  assert.ok(data.every((a) => a.isActive === false && a.deletedAt === null));

  const invalido = await call("GET", "/api/agents?isActive=maybe", userA.accessToken);
  assert.equal(invalido.status, 400);
});

// ---------------------------------------------------------------------------
// POST /api/agents/:id/test-message — el endpoint interno de prueba del loop
// (paso 2b). El proveedor de LLM se instala con setLlmProviderForTests antes
// de cada caso y se saca después: por HTTP no hay forma de inyectarlo en el
// request. El loop en sí (tools reales, guardrails, handoff, ventana) está
// probado en agentOrchestration.integration-test.ts; acá se prueba la cadena
// HTTP: autenticación, autorización, multi-tenant, validación del body y la
// forma de la respuesta.
// ---------------------------------------------------------------------------

function proveedorGuionado(guion: LlmCompletionResult[]): {
  proveedor: LlmProvider;
  requests: LlmCompletionRequest[];
} {
  const requests: LlmCompletionRequest[] = [];
  return {
    requests,
    proveedor: {
      name: "doble",
      complete(request) {
        requests.push(request);
        return Promise.resolve(guion[Math.min(requests.length - 1, guion.length - 1)]);
      },
    },
  };
}

async function crearContacto(organizationId: string) {
  return prisma.contact.create({
    data: { organizationId, firstName: "Ana", lastName: "Pérez" },
  });
}

function testMessage(agentId: unknown, token: string, body: Record<string, unknown>) {
  return call("POST", `/api/agents/${agentId}/test-message`, token, body);
}

test("POST /api/agents/:id/test-message — ADMIN conversa con el agente y recibe respuesta, tool calls y estado", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    name: "Probador",
    channels: ["WEB"],
  });
  const contacto = await crearContacto(orgA.id);
  const doble = proveedorGuionado([{ text: "Hola, ¿en qué te ayudo?", toolCalls: [] }]);
  setLlmProviderForTests(doble.proveedor);
  try {
    const res = await testMessage(agente.id, adminA.accessToken, {
      contactId: contacto.id,
      message: "Hola",
    });
    const crudo = await res.text();
    assert.equal(res.status, 200, crudo);
    const body = JSON.parse(crudo) as Record<string, unknown>;
    assert.equal(body.respuesta, "Hola, ¿en qué te ayudo?");
    assert.equal(body.status, "ACTIVE");
    assert.equal(body.handoff, false);
    assert.deepEqual(body.toolCalls, []);
    assert.equal(typeof body.conversationId, "string");

    assert.equal(doble.requests.length, 1);
    assert.deepEqual(doble.requests[0].messages, [{ role: "user", content: "Hola" }]);

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: String(body.conversationId) },
    });
    assert.equal(conversation.organizationId, orgA.id);
    assert.equal(conversation.contactId, contacto.id);
  } finally {
    resetLlmProviderParaTests();
  }
});

test("POST /api/agents/:id/test-message — la derivación llega por HTTP con status y mensaje de cierre", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    channels: ["WEB"],
    enabledTools: ["create_opportunity"],
    guardrails: { accionesProhibidas: ["create_opportunity"] },
  });
  const contacto = await crearContacto(orgA.id);
  const doble = proveedorGuionado([
    { text: null, toolCalls: [{ id: "c", name: "create_opportunity", arguments: { title: "x" } }] },
  ]);
  setLlmProviderForTests(doble.proveedor);
  try {
    const res = await testMessage(agente.id, adminA.accessToken, {
      contactId: contacto.id,
      message: "Creala igual",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      respuesta: string;
      handoff: boolean;
      handoffActivityId: string | null;
      toolCalls: { allowed: boolean }[];
    };
    assert.equal(body.handoff, true);
    assert.equal(body.status, "TRANSFERRED_TO_HUMAN");
    assert.equal(body.respuesta, MENSAJE_DE_HANDOFF);
    assert.ok(body.toolCalls.length > 0 && body.toolCalls.every((tc) => tc.allowed === false));
    // Paso 4: el contacto de este archivo no tiene vendedor, así que la
    // derivación es silenciosa y el endpoint lo dice.
    assert.equal(body.handoffActivityId, null);
  } finally {
    resetLlmProviderParaTests();
  }
});

test("POST /api/agents/:id/test-message — USER recibe 403; sin token 401; nada se persiste", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, { channels: ["WEB"] });
  const contacto = await crearContacto(orgA.id);
  const doble = proveedorGuionado([{ text: "no", toolCalls: [] }]);
  setLlmProviderForTests(doble.proveedor);
  try {
    const user = await testMessage(agente.id, userA.accessToken, {
      contactId: contacto.id,
      message: "Hola",
    });
    assert.equal(user.status, 403);

    const anonimo = await fetch(`${baseUrl}/api/agents/${agente.id}/test-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId: contacto.id, message: "Hola" }),
    });
    assert.equal(anonimo.status, 401);

    assert.equal(doble.requests.length, 0);
    assert.equal(await prisma.conversation.count({ where: { contactId: contacto.id } }), 0);
  } finally {
    resetLlmProviderParaTests();
  }
});

test("POST /api/agents/:id/test-message — multi-tenant: agente ajeno 404, contacto ajeno 400, agente borrado 404", async () => {
  const agenteDeA = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    channels: ["WEB"],
  });
  const contactoDeA = await crearContacto(orgA.id);
  const contactoDeB = await crearContacto(orgB.id);
  const doble = proveedorGuionado([{ text: "no", toolCalls: [] }]);
  setLlmProviderForTests(doble.proveedor);
  try {
    // B intenta usar el agente de A con su propio contacto.
    const ajeno = await testMessage(agenteDeA.id, adminB.accessToken, {
      contactId: contactoDeB.id,
      message: "Hola",
    });
    assert.equal(ajeno.status, 404);

    // A usa su agente con un contacto de B.
    const contactoAjeno = await testMessage(agenteDeA.id, adminA.accessToken, {
      contactId: contactoDeB.id,
      message: "Hola",
    });
    assert.equal(contactoAjeno.status, 400);

    // Un agente borrado no conversa.
    await call("DELETE", `/api/agents/${agenteDeA.id}`, adminA.accessToken);
    const borrado = await testMessage(agenteDeA.id, adminA.accessToken, {
      contactId: contactoDeA.id,
      message: "Hola",
    });
    assert.equal(borrado.status, 404);

    assert.equal(doble.requests.length, 0);
  } finally {
    resetLlmProviderParaTests();
  }
});

test("POST /api/agents/:id/test-message — validación del body y del canal", async () => {
  const sinWeb = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    channels: ["WHATSAPP"],
  });
  const contacto = await crearContacto(orgA.id);
  setLlmProviderForTests(proveedorGuionado([{ text: "ok", toolCalls: [] }]).proveedor);
  try {
    const sinMensaje = await testMessage(sinWeb.id, adminA.accessToken, {
      contactId: contacto.id,
      message: "   ",
    });
    assert.equal(sinMensaje.status, 400);
    assert.match(await mensajeDeError(sinMensaje), /message es requerido/);

    const sinContacto = await testMessage(sinWeb.id, adminA.accessToken, { message: "Hola" });
    assert.equal(sinContacto.status, 400);

    // El canal por defecto es WEB y este agente no opera ahí.
    const canal = await testMessage(sinWeb.id, adminA.accessToken, {
      contactId: contacto.id,
      message: "Hola",
    });
    assert.equal(canal.status, 400);
    assert.match(await mensajeDeError(canal), /no opera en el canal WEB/);

    // Por WHATSAPP sí.
    const porWhatsapp = await testMessage(sinWeb.id, adminA.accessToken, {
      contactId: contacto.id,
      message: "Hola",
      channel: "WHATSAPP",
    });
    const crudo = await porWhatsapp.text();
    assert.equal(porWhatsapp.status, 200, crudo);
  } finally {
    resetLlmProviderParaTests();
  }
});

// ---------------------------------------------------------------------------
// Paso 5a — allowedOrigins en el CRUD de Agent. La validación en sí
// (utils/origin.ts) está cubierta en origin.test.ts; acá se prueba que el
// borde HTTP la aplica, normaliza, deduplica y acepta la lista vacía.
// ---------------------------------------------------------------------------

test("allowedOrigins — se normalizan y deduplican al crear; PATCH los reemplaza; vacío es válido", async () => {
  const agente = await crearAgentePorHttp(adminA.accessToken, orgA.branchId, {
    allowedOrigins: ["https://Ejemplo.com/", "https://ejemplo.com", "http://localhost:5173"],
  });
  assert.deepEqual(agente.allowedOrigins, ["https://ejemplo.com", "http://localhost:5173"]);

  const patch = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {
    allowedOrigins: ["https://otro.example"],
  });
  assert.equal(patch.status, 200);
  assert.deepEqual(((await patch.json()) as Record<string, unknown>).allowedOrigins, [
    "https://otro.example",
  ]);

  // Vacía deshabilita el widget: es un estado, no un error.
  const vacia = await call("PATCH", `/api/agents/${agente.id}`, adminA.accessToken, {
    allowedOrigins: [],
  });
  assert.equal(vacia.status, 200);
  assert.deepEqual(((await vacia.json()) as Record<string, unknown>).allowedOrigins, []);

  const fila = await prisma.agent.findUniqueOrThrow({ where: { id: String(agente.id) } });
  assert.deepEqual(fila.allowedOrigins, []);
});

test("allowedOrigins — rechaza con path, sin esquema, con query, con credenciales o con esquema no web", async () => {
  const casos: [string, RegExp][] = [
    ["https://ejemplo.com/widget", /no es un origen válido/],
    ["ejemplo.com", /no es un origen válido/],
    ["https://ejemplo.com/?x=1", /no es un origen válido/],
    ["https://user:pass@ejemplo.com", /no es un origen válido/],
    ["ftp://ejemplo.com", /no es un origen válido/],
  ];
  for (const [origen, esperado] of casos) {
    const res = await call(
      "POST",
      "/api/agents",
      adminA.accessToken,
      cuerpoMinimo(orgA.branchId, { allowedOrigins: [origen] }),
    );
    assert.equal(res.status, 400, `debía ser 400 para ${origen}`);
    assert.match(await mensajeDeError(res), esperado);
  }
});
