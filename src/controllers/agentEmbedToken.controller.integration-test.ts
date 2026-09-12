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
import { findEmbedTokenByHash } from "../repositories/agentEmbedToken.repository";
import { findRoleByName } from "../repositories/role.repository";
import { agentRouter } from "../routes/agent.routes";
import { agentEmbedTokenRouter } from "../routes/agentEmbedToken.routes";
import { hashEmbedToken } from "../utils/agentEmbedToken";

// ---------------------------------------------------------------------------
// Gestión de tokens de embed del widget (paso 5a) por HTTP real contra una
// app Express real, montando los routers reales —con su authenticate, su
// authorize y su rate limiter— contra Postgres y GoTrue reales. Calcado de
// apiKey.controller.integration-test.ts.
//
// Lo que este archivo prueba, y por qué cada cosa:
//
//   1. EL TOKEN EN CLARO NO REAPARECE EN NINGUNA RESPUESTA POSTERIOR A LA
//      CREACIÓN, y tokenHash no sale por la API en ningún shape. Se verifica
//      sobre el texto crudo de cada respuesta.
//   2. USER recibe 403 en las tres operaciones, incluida la lectura.
//   3. Aislamiento por organización (B no ve ni revoca tokens de A) Y POR
//      AGENTE (el token del agente A1 no existe bajo la ruta del agente A2 de
//      la misma organización).
//   4. Revocar dos veces da 409; un token revocado se resuelve por hash con
//      revokedAt puesto — es lo que el 5b va a usar para rechazarlo.
//   5. Dar de baja el agente revoca sus tokens en cascada.
// ---------------------------------------------------------------------------

const PASSWORD = "Embed-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

interface Fixture {
  orgA: string;
  orgB: string;
  adminA: FixtureUser;
  userA: FixtureUser;
  adminB: FixtureUser;
  agentA1: string;
  agentA2: string;
  agentB: string;
}

let fx: Fixture;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", agentRouter);
  app.use("/api", agentEmbedTokenRouter);
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

async function createOrganizationWithAgents(label: string, cuantos: number) {
  const org = await prisma.organization.create({
    data: {
      name: `Embed test org ${label} ${randomUUID()}`,
      slug: `embed-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: `Sucursal ${label}`, timezone: "America/Montevideo" },
  });
  const agents: string[] = [];
  for (let i = 0; i < cuantos; i++) {
    const agent = await prisma.agent.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        name: `Agente ${label} ${i + 1}`,
        instructions: "x",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: [],
        channels: ["WEB"],
        guardrails: {},
      },
    });
    agents.push(agent.id);
  }
  return { orgId: org.id, agents };
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `embed-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Embed Test ${label}`,
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

async function crearToken(agentId: string, token: string) {
  const res = await call("POST", `/api/agents/${agentId}/embed-tokens`, token);
  const crudo = await res.text();
  assert.equal(res.status, 201, crudo);
  return JSON.parse(crudo) as { id: string; token: string; tokenPrefix: string };
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const a = await createOrganizationWithAgents("a", 2);
  const b = await createOrganizationWithAgents("b", 1);
  fx = {
    orgA: a.orgId,
    orgB: b.orgId,
    adminA: await createFixtureUser("admin-a", a.orgId, "ADMIN"),
    userA: await createFixtureUser("user-a", a.orgId, "USER"),
    adminB: await createFixtureUser("admin-b", b.orgId, "ADMIN"),
    agentA1: a.agents[0],
    agentA2: a.agents[1],
    agentB: b.agents[0],
  };
});

after(async () => {
  if (closeApp) await closeApp();
  if (!fx) return;
  for (const orgId of [fx.orgA, fx.orgB]) {
    await prisma.agentEmbedToken.deleteMany({ where: { organizationId: orgId } });
    await prisma.agent.deleteMany({ where: { organizationId: orgId } });
    await prisma.branch.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
  for (const u of [fx.adminA, fx.userA, fx.adminB]) {
    await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------

test("POST /api/agents/:id/embed-tokens — 201 con el token en claro exactamente una vez, y sin tokenHash", async () => {
  const res = await call("POST", `/api/agents/${fx.agentA1}/embed-tokens`, fx.adminA.accessToken);
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;

  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "agentId",
      "createdAt",
      "id",
      "lastUsedAt",
      "organizationId",
      "revokedAt",
      "token",
      "tokenPrefix",
    ],
    "el body no debe incluir tokenHash ni nada fuera de la proyección pública + token",
  );

  const token = body.token as string;
  assert.ok(token.startsWith("embed_"), "el token debe traer el prefijo identificable");
  assert.equal(token.length, 49, "6 de prefijo + 43 de base64url sobre 32 bytes");
  assert.equal(body.tokenPrefix, token.slice(0, 14));
  assert.equal(body.agentId, fx.agentA1);
  assert.equal(body.organizationId, fx.orgA);
  assert.equal(body.revokedAt, null);
  assert.equal(body.lastUsedAt, null, "nace en null; lo escribe el 5b al usarlo");

  // Lo persistido es el hash, no el token.
  const fila = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id: String(body.id) } });
  assert.equal(fila.tokenHash, hashEmbedToken(token));
  assert.ok(!fila.tokenHash.includes(token));
});

test("el token en claro no reaparece en NINGUNA respuesta posterior a la creación, ni el hash por ningún camino", async () => {
  const { token, id } = await crearToken(fx.agentA1, fx.adminA.accessToken);

  const listado = await call(
    "GET",
    `/api/agents/${fx.agentA1}/embed-tokens`,
    fx.adminA.accessToken,
  );
  const textoListado = await listado.text();
  assert.equal(listado.status, 200);
  assert.ok(!textoListado.includes(token), "el listado no puede contener el token en claro");
  assert.ok(textoListado.includes(token.slice(0, 14)), "pero sí el prefijo, para identificarlo");

  const revocado = await call(
    "DELETE",
    `/api/agents/${fx.agentA1}/embed-tokens/${id}`,
    fx.adminA.accessToken,
  );
  const textoRevocado = await revocado.text();
  assert.equal(revocado.status, 200);
  assert.ok(!textoRevocado.includes(token));

  const agente = await call("GET", `/api/agents/${fx.agentA1}`, fx.adminA.accessToken);
  const textoAgente = await agente.text();
  assert.ok(!textoAgente.includes(token), "el GET del agente tampoco expone sus tokens");

  for (const texto of [textoListado, textoRevocado, textoAgente]) {
    assert.ok(!texto.includes("tokenHash"), "tokenHash no debe salir por la API");
  }
});

test("GET /api/agents/:id/embed-tokens — lista solo los del agente, del más nuevo al más viejo, revocados incluidos", async () => {
  const primero = await crearToken(fx.agentA2, fx.adminA.accessToken);
  const segundo = await crearToken(fx.agentA2, fx.adminA.accessToken);
  await call(
    "DELETE",
    `/api/agents/${fx.agentA2}/embed-tokens/${primero.id}`,
    fx.adminA.accessToken,
  );

  const res = await call("GET", `/api/agents/${fx.agentA2}/embed-tokens`, fx.adminA.accessToken);
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as {
    data: { id: string; agentId: string; revokedAt: unknown }[];
  };

  assert.ok(
    data.every((t) => t.agentId === fx.agentA2),
    "solo tokens de este agente",
  );
  const ids = data.map((t) => t.id);
  assert.ok(ids.indexOf(segundo.id) < ids.indexOf(primero.id), "el más nuevo primero");
  assert.notEqual(
    data.find((t) => t.id === primero.id)?.revokedAt,
    null,
    "el revocado sigue listado",
  );
});

test("USER recibe 403 en las tres operaciones, incluida la lectura", async () => {
  const { id } = await crearToken(fx.agentA1, fx.adminA.accessToken);

  const lista = await call("GET", `/api/agents/${fx.agentA1}/embed-tokens`, fx.userA.accessToken);
  assert.equal(lista.status, 403);
  const crea = await call("POST", `/api/agents/${fx.agentA1}/embed-tokens`, fx.userA.accessToken);
  assert.equal(crea.status, 403);
  const revoca = await call(
    "DELETE",
    `/api/agents/${fx.agentA1}/embed-tokens/${id}`,
    fx.userA.accessToken,
  );
  assert.equal(revoca.status, 403);

  const fila = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id } });
  assert.equal(fila.revokedAt, null);
});

test("aislamiento por organización: B no lista, no crea ni revoca sobre un agente de A", async () => {
  const { id } = await crearToken(fx.agentA1, fx.adminA.accessToken);

  const lista = await call("GET", `/api/agents/${fx.agentA1}/embed-tokens`, fx.adminB.accessToken);
  assert.equal(lista.status, 404);
  const crea = await call("POST", `/api/agents/${fx.agentA1}/embed-tokens`, fx.adminB.accessToken);
  assert.equal(crea.status, 404);
  const revoca = await call(
    "DELETE",
    `/api/agents/${fx.agentA1}/embed-tokens/${id}`,
    fx.adminB.accessToken,
  );
  assert.equal(revoca.status, 404);

  const fila = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id } });
  assert.equal(fila.revokedAt, null);
  assert.equal(await prisma.agentEmbedToken.count({ where: { organizationId: fx.orgB } }), 0);
});

test("aislamiento por agente: el token de A1 no existe bajo la ruta de A2, ni en el listado ni para revocar", async () => {
  const { id } = await crearToken(fx.agentA1, fx.adminA.accessToken);

  const lista = await call("GET", `/api/agents/${fx.agentA2}/embed-tokens`, fx.adminA.accessToken);
  const { data } = (await lista.json()) as { data: { id: string }[] };
  assert.ok(!data.some((t) => t.id === id));

  const revoca = await call(
    "DELETE",
    `/api/agents/${fx.agentA2}/embed-tokens/${id}`,
    fx.adminA.accessToken,
  );
  assert.equal(revoca.status, 404);

  const fila = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id } });
  assert.equal(fila.revokedAt, null, "la ruta del otro agente no lo tocó");
});

test("revocar dos veces: 200 y después 409; y el token revocado se resuelve por hash con revokedAt puesto", async () => {
  const { id, token } = await crearToken(fx.agentA1, fx.adminA.accessToken);

  // Antes de revocar: usable para el 5b (revokedAt null) y con el agente
  // resuelto en el mismo round-trip.
  const antes = await findEmbedTokenByHash(hashEmbedToken(token));
  assert.ok(antes);
  assert.equal(antes.revokedAt, null);
  assert.equal(antes.agentId, fx.agentA1);
  assert.equal(antes.organizationId, fx.orgA);
  assert.deepEqual(antes.agent.allowedOrigins, [], "el agente del fixture no tiene orígenes");

  const primera = await call(
    "DELETE",
    `/api/agents/${fx.agentA1}/embed-tokens/${id}`,
    fx.adminA.accessToken,
  );
  assert.equal(primera.status, 200);
  const segunda = await call(
    "DELETE",
    `/api/agents/${fx.agentA1}/embed-tokens/${id}`,
    fx.adminA.accessToken,
  );
  assert.equal(segunda.status, 409);

  const despues = await findEmbedTokenByHash(hashEmbedToken(token));
  assert.ok(despues);
  assert.notEqual(despues.revokedAt, null, "ya no es usable");

  // Un token que nadie emitió no resuelve a nada.
  assert.equal(await findEmbedTokenByHash(hashEmbedToken("embed_inventado")), null);
});

test("DELETE /api/agents/:id revoca en cascada los tokens activos del agente", async () => {
  // Un agente propio para no dejar sin agente al resto de los casos.
  const { agents } = await (async () => {
    const branch = await prisma.branch.findFirstOrThrow({ where: { organizationId: fx.orgA } });
    const agent = await prisma.agent.create({
      data: {
        organizationId: fx.orgA,
        branchId: branch.id,
        name: "Efímero",
        instructions: "x",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: [],
        channels: ["WEB"],
        guardrails: {},
      },
    });
    return { agents: [agent.id] };
  })();
  const agentId = agents[0];

  const vivo1 = await crearToken(agentId, fx.adminA.accessToken);
  const vivo2 = await crearToken(agentId, fx.adminA.accessToken);
  const yaRevocado = await crearToken(agentId, fx.adminA.accessToken);
  await call(
    "DELETE",
    `/api/agents/${agentId}/embed-tokens/${yaRevocado.id}`,
    fx.adminA.accessToken,
  );
  const marcaPrevia = (
    await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id: yaRevocado.id } })
  ).revokedAt;

  const del = await call("DELETE", `/api/agents/${agentId}`, fx.adminA.accessToken);
  assert.equal(del.status, 204);

  for (const t of [vivo1, vivo2]) {
    const fila = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id: t.id } });
    assert.notEqual(fila.revokedAt, null, "el token vivo quedó revocado con el agente");
  }
  const previo = await prisma.agentEmbedToken.findUniqueOrThrow({ where: { id: yaRevocado.id } });
  assert.equal(
    previo.revokedAt?.getTime(),
    marcaPrevia?.getTime(),
    "el ya revocado conserva su marca",
  );

  // Y sobre un agente borrado ya no se emiten tokens.
  const crea = await call("POST", `/api/agents/${agentId}/embed-tokens`, fx.adminA.accessToken);
  assert.equal(crea.status, 404);
});
