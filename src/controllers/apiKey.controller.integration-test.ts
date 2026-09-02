import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { apiKeyRouter } from "../routes/apiKey.routes";
import { sourceRouter } from "../routes/source.routes";

// Test de integración de la gestión de API keys (ítem 3 de
// docs/ingestion-architecture.md §6): HTTP real contra una app Express real,
// montando los routers reales —con su authenticate, su authorize y su rate
// limiter— contra Postgres y GoTrue reales. Sin mocks. Mismo patrón que
// me.controller.integration-test.ts.
//
// Lo que este archivo prueba, y por qué cada cosa:
//
//   1. USER recibe 403 en las tres operaciones. La gestión de credenciales de
//      ingesta es ADMIN-only y eso tiene que ser una propiedad del sistema
//      montado, no del router leído.
//   2. El listado de la organización A no ve las claves de la B.
//   3. LA CLAVE EN CLARO NO REAPARECE EN NINGUNA RESPUESTA POSTERIOR A LA
//      CREACIÓN. Es la promesa central del diseño y se verifica sobre el texto
//      crudo de la respuesta, no campo por campo: si un refactor agregara la
//      clave en cualquier lugar del payload, esto lo ve igual.
//   4. keyHash no sale por la API en ningún shape.
//   5. Revocar dos veces da 409, no un no-op silencioso.
//   6. Retirar una Source revoca sus claves en cascada.
//
// Un solo fixture (dos organizaciones, tres identidades reales de Supabase) se
// crea en `before` y se reusa: cada identidad cuesta una llamada a la Admin
// API más un login real.

const PASSWORD = "ApiKey-test-password-123!";

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
  sourceA: string;
  sourceB: string;
}

let fx: Fixture;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", sourceRouter);
  app.use("/api", apiKeyRouter);
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

async function createOrganization(label: string) {
  const org = await prisma.organization.create({
    data: {
      name: `ApiKey test org ${label} ${randomUUID()}`,
      slug: `apikey-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `apikey-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `ApiKey Test ${label}`,
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
  };
}

// Helper de request: siempre con token, siempre JSON.
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

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const orgA = await createOrganization("a");
  const orgB = await createOrganization("b");

  const adminA = await createFixtureUser("admin-a", orgA, "ADMIN");
  const userA = await createFixtureUser("user-a", orgA, "USER");
  const adminB = await createFixtureUser("admin-b", orgB, "ADMIN");

  const sourceA = await prisma.source.create({
    data: { organizationId: orgA, name: "Landing A", type: "WEBHOOK" },
  });
  const sourceB = await prisma.source.create({
    data: { organizationId: orgB, name: "Landing B", type: "WEBHOOK" },
  });

  fx = {
    orgA,
    orgB,
    adminA,
    userA,
    adminB,
    sourceA: sourceA.id,
    sourceB: sourceB.id,
  };
});

after(async () => {
  if (closeApp) await closeApp();
  if (!fx) return;

  const ambas = { in: [fx.orgA, fx.orgB] };
  // api_keys antes que sources: la FK es RESTRICT.
  await prisma.apiKey.deleteMany({ where: { organizationId: ambas } });
  await prisma.source.deleteMany({ where: { organizationId: ambas } });
  await prisma.user.deleteMany({ where: { organizationId: ambas } });
  await prisma.organization.deleteMany({ where: { id: ambas } });

  for (const u of [fx.adminA, fx.userA, fx.adminB]) {
    await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// El shape de la creación, y la promesa de "una sola vez"
// ---------------------------------------------------------------------------

test("POST /api/api-keys — 201 con la clave en claro exactamente una vez, y sin keyHash", async () => {
  const res = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId: fx.sourceA,
  });
  assert.equal(res.status, 201);

  const body = (await res.json()) as Record<string, unknown>;

  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "createdAt",
      "id",
      "key",
      "keyPrefix",
      "lastUsedAt",
      "organizationId",
      "revokedAt",
      "sourceId",
      "updatedAt",
    ],
    "el body no debe incluir keyHash ni ningún campo fuera de la proyección pública + key",
  );

  const key = body.key as string;
  assert.ok(key.startsWith("crm_"), "la clave debe traer el prefijo identificable");
  assert.equal(key.length, 47, "4 de prefijo + 43 de base64url sobre 32 bytes");
  assert.equal(
    body.keyPrefix,
    key.slice(0, 12),
    "keyPrefix son los primeros 12 caracteres de la clave devuelta",
  );
  assert.equal(body.revokedAt, null);
  assert.equal(body.lastUsedAt, null, "lastUsedAt nace en null y nadie la escribe hasta el ítem 4");
});

test("la clave en claro no reaparece en NINGUNA respuesta posterior a la creación", async () => {
  const created = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId: fx.sourceA,
  });
  const { key, id } = (await created.json()) as { key: string; id: string };

  // Se mira el texto CRUDO de cada respuesta, no campo por campo: si un
  // refactor colara la clave en cualquier lugar del payload, esto lo ve igual.
  const listado = await call("GET", "/api/api-keys", fx.adminA.accessToken);
  const textoListado = await listado.text();
  assert.equal(listado.status, 200);
  assert.ok(!textoListado.includes(key), "el listado no puede contener la clave en claro");

  const revocada = await call("DELETE", `/api/api-keys/${id}`, fx.adminA.accessToken);
  const textoRevocada = await revocada.text();
  assert.equal(revocada.status, 200);
  assert.ok(
    !textoRevocada.includes(key),
    "la respuesta de revocación no puede contener la clave en claro",
  );

  // Y tampoco el hash, por ningún camino.
  for (const texto of [textoListado, textoRevocada]) {
    assert.ok(!texto.includes("keyHash"), "keyHash no debe salir por la API");
  }
});

test("GET /api/api-keys — el listado expone solo la proyección pública", async () => {
  // B-34: antes este test afirmaba `body.data.length > 0` confiando en que
  // los tests ANTERIORES del archivo hubieran creado claves — corrido solo
  // (o si otro test las borrara antes), el listado venía vacío y el for de
  // abajo no verificaba ningún shape. La clave sobre la que se afirma se
  // crea ACÁ: el resultado es el mismo corriendo aislado que con el archivo.
  const creada = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId: fx.sourceA,
  });
  assert.equal(creada.status, 201);
  const { id: idCreada } = (await creada.json()) as { id: string };

  const res = await call("GET", "/api/api-keys", fx.adminA.accessToken);
  assert.equal(res.status, 200);

  const body = (await res.json()) as { data: Record<string, unknown>[] };
  assert.ok(
    body.data.some((item) => item.id === idCreada),
    "el listado debe incluir la clave recién creada por ESTE test",
  );

  for (const item of body.data) {
    assert.deepEqual(Object.keys(item).sort(), [
      "createdAt",
      "id",
      "keyPrefix",
      "lastUsedAt",
      "organizationId",
      "revokedAt",
      "sourceId",
      "updatedAt",
    ]);
  }
});

// ---------------------------------------------------------------------------
// Autorización y aislamiento
// ---------------------------------------------------------------------------

test("USER recibe 403 en las tres operaciones de API keys", async () => {
  const listar = await call("GET", "/api/api-keys", fx.userA.accessToken);
  assert.equal(listar.status, 403);

  const crear = await call("POST", "/api/api-keys", fx.userA.accessToken, {
    sourceId: fx.sourceA,
  });
  assert.equal(crear.status, 403);

  const revocar = await call("DELETE", `/api/api-keys/${randomUUID()}`, fx.userA.accessToken);
  assert.equal(
    revocar.status,
    403,
    "authorize corre antes que el handler: un USER no llega ni a un 404",
  );
});

test("USER recibe 403 también en la gestión de Sources", async () => {
  const listar = await call("GET", "/api/sources", fx.userA.accessToken);
  assert.equal(listar.status, 403, "las Sources son ADMIN-only también en lectura");

  const crear = await call("POST", "/api/sources", fx.userA.accessToken, {
    name: "no debería crearse",
    type: "WEBHOOK",
  });
  assert.equal(crear.status, 403);
});

test("el listado de la organización A no ve ninguna clave de la B", async () => {
  const creadaB = await call("POST", "/api/api-keys", fx.adminB.accessToken, {
    sourceId: fx.sourceB,
  });
  assert.equal(creadaB.status, 201);
  const { id: idB } = (await creadaB.json()) as { id: string };

  const listadoA = await call("GET", "/api/api-keys", fx.adminA.accessToken);
  const bodyA = (await listadoA.json()) as {
    data: { id: string; organizationId: string; sourceId: string }[];
  };

  assert.ok(
    !bodyA.data.some((k) => k.id === idB),
    "la clave de la organización B no puede aparecer en el listado de A",
  );
  for (const k of bodyA.data) {
    assert.equal(k.organizationId, fx.orgA);
    assert.notEqual(k.sourceId, fx.sourceB);
  }

  // Y el filtro por sourceId ajeno tampoco es una puerta lateral.
  const filtrado = await call("GET", `/api/api-keys?sourceId=${fx.sourceB}`, fx.adminA.accessToken);
  const bodyFiltrado = (await filtrado.json()) as { data: unknown[] };
  assert.equal(
    bodyFiltrado.data.length,
    0,
    "filtrar por una Source ajena devuelve vacío, no las claves de la otra organización",
  );
});

test("crear una clave contra una Source de otra organización da 404", async () => {
  const res = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId: fx.sourceB,
  });
  assert.equal(res.status, 404);

  const body = (await res.json()) as { error?: { message?: string } };
  assert.equal(
    body.error?.message,
    "Fuente no encontrada",
    "404, no 403: para la organización A esa fuente no existe, y el mensaje no debe confirmar lo contrario",
  );
});

test("revocar una clave de otra organización da 404 y no la toca", async () => {
  const creadaB = await call("POST", "/api/api-keys", fx.adminB.accessToken, {
    sourceId: fx.sourceB,
  });
  const { id: idB } = (await creadaB.json()) as { id: string };

  const res = await call("DELETE", `/api/api-keys/${idB}`, fx.adminA.accessToken);
  assert.equal(res.status, 404);

  const fila = await prisma.apiKey.findUniqueOrThrow({ where: { id: idB } });
  assert.equal(fila.revokedAt, null, "la clave de B debe seguir activa");
});

// ---------------------------------------------------------------------------
// Revocación
// ---------------------------------------------------------------------------

test("revocar dos veces: la primera 200, la segunda 409 — no es idempotente a propósito", async () => {
  const creada = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId: fx.sourceA,
  });
  const { id } = (await creada.json()) as { id: string };

  const primera = await call("DELETE", `/api/api-keys/${id}`, fx.adminA.accessToken);
  assert.equal(primera.status, 200);
  const cuerpo = (await primera.json()) as { revokedAt: string | null };
  assert.ok(cuerpo.revokedAt, "la respuesta devuelve la clave ya con revokedAt");

  const segunda = await call("DELETE", `/api/api-keys/${id}`, fx.adminA.accessToken);
  assert.equal(
    segunda.status,
    409,
    "una transición ya consumada no se finge como una operación nueva exitosa (mismo criterio que Invitation)",
  );
  const error = (await segunda.json()) as { error?: { message?: string } };
  assert.equal(error.error?.message, "Esta clave ya fue revocada");
});

test("DELETE /api/sources/:id revoca en cascada las claves de la fuente", async () => {
  const fuente = await call("POST", "/api/sources", fx.adminA.accessToken, {
    name: `Fuente descartable ${randomUUID()}`,
    type: "FILE_IMPORT",
  });
  assert.equal(fuente.status, 201);
  const { id: sourceId } = (await fuente.json()) as { id: string };

  const claves: string[] = [];
  for (let i = 0; i < 2; i++) {
    const creada = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
      sourceId,
    });
    assert.equal(creada.status, 201);
    claves.push(((await creada.json()) as { id: string }).id);
  }

  const borrada = await call("DELETE", `/api/sources/${sourceId}`, fx.adminA.accessToken);
  assert.equal(borrada.status, 204);

  for (const id of claves) {
    const fila = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    assert.ok(
      fila.revokedAt,
      "retirar una fuente tiene que matar sus credenciales, no dejarlas vivas esperando al ítem 4",
    );
  }

  // La fuente ya no existe para la API, y crear una clave contra ella falla.
  const consulta = await call("GET", `/api/sources/${sourceId}`, fx.adminA.accessToken);
  assert.equal(consulta.status, 404);

  const nuevaClave = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId,
  });
  assert.equal(nuevaClave.status, 404);
});

test("una Source pausada (isActive: false) sigue aceptando claves nuevas", async () => {
  const fuente = await call("POST", "/api/sources", fx.adminA.accessToken, {
    name: `Fuente pausable ${randomUUID()}`,
    type: "WEBHOOK",
  });
  const { id: sourceId } = (await fuente.json()) as { id: string };

  const pausada = await call("PATCH", `/api/sources/${sourceId}`, fx.adminA.accessToken, {
    isActive: false,
  });
  assert.equal(pausada.status, 200);
  assert.equal(((await pausada.json()) as { isActive: boolean }).isActive, false);

  // Pausar es reversible y rotar credenciales durante una pausa es legítimo:
  // el chequeo de isActive es del ítem 4, en el momento de ingestar.
  const creada = await call("POST", "/api/api-keys", fx.adminA.accessToken, {
    sourceId,
  });
  assert.equal(creada.status, 201, "pausar la ingesta no debe impedir rotar credenciales");
});

// ---------------------------------------------------------------------------
// B-21 (docs/auditoria-2026-08-29.md) — `page` con tope, por HTTP real: la
// cadena completa parseOrThrow → errorHandler → 400. Mismo patrón que el test
// "pageSize por encima del máximo da 400" de ingestionEvent (S2-5).
// ---------------------------------------------------------------------------

test("B-21: GET /api/api-keys?page=10001 da 400 — page tiene tope, igual que pageSize", async () => {
  const res = await call("GET", "/api/api-keys?page=10001", fx.adminA.accessToken);
  assert.equal(res.status, 400);
  const texto = await res.text();
  assert.ok(texto.includes("10000"), `el mensaje tiene que nombrar el tope: ${texto}`);
});

test("B-21: GET /api/api-keys?page=10000 exacto sigue siendo válido", async () => {
  const res = await call("GET", "/api/api-keys?page=10000", fx.adminA.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[]; pagination: { page: number } };
  assert.equal(body.pagination.page, 10_000);
  assert.deepEqual(body.data, [], "una página que nadie tiene: vacía, no un error");
});
