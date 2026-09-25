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
import { findActiveKnowledgeBaseEntriesByBranch } from "../repositories/knowledgeBaseEntry.repository";
import { findRoleByName } from "../repositories/role.repository";
import { knowledgeBaseEntryRouter } from "../routes/knowledgeBaseEntry.routes";

// ---------------------------------------------------------------------------
// CRUD de /api/knowledge-base (ítem 59 de docs/frontend-cambios-pendientes.md)
// por HTTP real contra una app Express real, montando el router real —con su
// authenticate, su authorize y su rate limiter— contra Postgres y GoTrue
// reales. Mismo patrón que agent.controller.integration-test.ts.
//
// Lo que se prueba acá y no se puede probar sin base ni sin la cadena real:
//
//   1. Solo ADMIN escribe: USER recibe 403 en POST/PATCH/DELETE y nada cambia;
//      el GET lo lee cualquiera de la organización.
//   2. Aislamiento multi-tenant: la organización B no ve, no edita y no borra
//      una entrada de la A — 404 en los tres, y la fila queda intacta.
//   3. Scoping por sucursal: un branchId de otra organización (o inexistente)
//      es 400 y no se crea nada, TANTO EN EL POST COMO EN EL PATCH; el listado
//      filtra por branchId.
//   4. La sucursal SÍ es editable, a diferencia de Agent — la diferencia de
//      diseño de este ítem, y por eso tiene su propio caso.
//   5. Soft delete: DELETE marca deletedAt, el GET pasa a 404, el listado lo
//      excluye, y la fila sigue en la base.
//   6. Lo que consume el loop del agente: findActiveKnowledgeBaseEntriesByBranch
//      devuelve solo las activas y no borradas de ESA sucursal, ordenadas.
//
// CADA ORGANIZACIÓN DE ESTE ARCHIVO ES PROPIA. El runner corre los archivos
// de integración en paralelo contra una base compartida; sin aislar por
// organización, dos archivos se pisarían los conteos del listado.
// ---------------------------------------------------------------------------

const PASSWORD = "Kb-test-password-123!";
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
  app.use("/api", knowledgeBaseEntryRouter);
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
      name: `KB ${etiqueta} ${randomUUID()}`,
      slug: `kb-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
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
  const email = `kb-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `KB Test ${label}`,
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

// Los tres campos que el POST exige. isActive tiene default en la base.
function cuerpoMinimo(branchId: string, extra: Record<string, unknown> = {}) {
  return {
    branchId,
    title: "Horarios",
    content: "Lunes a viernes de 9 a 18. Sábados de 9 a 13.",
    ...extra,
  };
}

async function crearEntradaPorHttp(
  token: string,
  branchId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await call("POST", "/api/knowledge-base", token, cuerpoMinimo(branchId, extra));
  // El body se lee UNA vez: un `${await res.text()}` dentro del mensaje del
  // assert se evalúa aunque el assert pase, y deja el body inutilizable.
  const crudo = await res.text();
  assert.equal(res.status, 201, `no se pudo crear la entrada: ${crudo}`);
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
    await prisma.knowledgeBaseEntry.deleteMany({ where: { organizationId: org.id } });
    // Las unidades del stock de los casos de §70: las entradas las referencian
    // con una FK, así que se van después de ellas y antes de la sucursal.
    await prisma.vehicle.deleteMany({ where: { organizationId: org.id } });
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

test("POST /api/knowledge-base — ADMIN crea con el cuerpo mínimo; nace activa", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);

  assert.equal(entrada.organizationId, orgA.id);
  assert.equal(entrada.branchId, orgA.branchId);
  assert.equal(entrada.title, "Horarios");
  assert.equal(entrada.content, "Lunes a viernes de 9 a 18. Sábados de 9 a 13.");
  assert.equal(entrada.isActive, true, "una entrada nueva entra al prompt sin configurar nada");
  assert.equal(entrada.deletedAt, null);
});

test("POST /api/knowledge-base — title y content se guardan trimeados; isActive: false se respeta", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, {
    title: "  Promo de invierno  ",
    content: "  20% en todos los servicios.  ",
    isActive: false,
  });

  assert.equal(entrada.title, "Promo de invierno");
  assert.equal(entrada.content, "20% en todos los servicios.");
  // Inactiva NO es borrada: existe, se lista, se edita, y simplemente no entra
  // al prompt de ningún agente de la sucursal.
  assert.equal(entrada.isActive, false);
  assert.equal(entrada.deletedAt, null);
});

test("POST /api/knowledge-base — validación de los tres campos de texto", async () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ title: undefined }, /title/],
    [{ title: "   " }, /title es requerido/],
    [{ title: "x".repeat(201) }, /title no puede superar los 200 caracteres/],
    [{ content: undefined }, /content/],
    [{ content: "   " }, /content es requerido/],
    [{ content: "x".repeat(10_001) }, /content no puede superar los 10000 caracteres/],
    [{ branchId: "no-es-uuid" }, /branchId inválido/],
    // isActive es z.boolean() pelado, igual que en Agent: el mensaje es el
    // genérico de Zod, sin nombre de campo.
    [{ isActive: "sí" }, /Expected boolean/],
  ];

  for (const [extra, esperado] of casos) {
    const res = await call(
      "POST",
      "/api/knowledge-base",
      adminA.accessToken,
      cuerpoMinimo(orgA.branchId, extra),
    );
    assert.equal(res.status, 400, `debía ser 400 para ${JSON.stringify(extra)}`);
    assert.match(await mensajeDeError(res), esperado);
  }
});

test("los topes son inclusivos: title de 200 y content de 10000 entran", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, {
    title: "x".repeat(200),
    content: "y".repeat(10_000),
  });
  assert.equal(String(entrada.title).length, 200);
  assert.equal(String(entrada.content).length, 10_000);
});

test("GET /api/knowledge-base — lista paginada de la organización; USER también puede leer", async () => {
  const res = await call("GET", "/api/knowledge-base?pageSize=100", userA.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  };

  const enBase = await prisma.knowledgeBaseEntry.count({
    where: { organizationId: orgA.id, deletedAt: null },
  });
  assert.equal(body.pagination.total, enBase);
  assert.equal(body.data.length, enBase);
  assert.ok(body.data.every((e) => e.organizationId === orgA.id));
});

test("GET /api/knowledge-base?search= filtra por título, sin mirar el contenido", async () => {
  const conTituloRaro = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, {
    title: `Estacionamiento ${randomUUID().slice(0, 8)}`,
    content: "Hay cochera propia sin costo.",
  });
  const titulo = String(conTituloRaro.title);

  const porTitulo = await call(
    "GET",
    `/api/knowledge-base?search=${encodeURIComponent(titulo.toLowerCase())}`,
    userA.accessToken,
  );
  assert.equal(porTitulo.status, 200);
  const { data } = (await porTitulo.json()) as { data: Record<string, unknown>[] };
  // Insensible a mayúsculas, como el search de agents.
  assert.deepEqual(
    data.map((e) => e.id),
    [conTituloRaro.id],
  );

  // El search NO mira el contenido, y es una decisión (ver buildWhere en el
  // repositorio): buscar dentro de 10.000 caracteres es búsqueda de verdad,
  // no un `contains` más.
  const porContenido = await call(
    "GET",
    "/api/knowledge-base?search=cochera%20propia",
    userA.accessToken,
  );
  const cuerpoContenido = (await porContenido.json()) as { pagination: { total: number } };
  assert.equal(cuerpoContenido.pagination.total, 0);
});

test("GET /api/knowledge-base/:id y PATCH — ADMIN edita; USER lee el resultado", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);

  const patch = await call("PATCH", `/api/knowledge-base/${entrada.id}`, adminA.accessToken, {
    title: "Horarios de atención",
    isActive: false,
  });
  const crudoPatch = await patch.text();
  assert.equal(patch.status, 200, crudoPatch);
  const editada = JSON.parse(crudoPatch) as Record<string, unknown>;
  assert.equal(editada.title, "Horarios de atención");
  assert.equal(editada.isActive, false);
  // Lo que no se mandó no cambia.
  assert.equal(editada.content, entrada.content);
  assert.equal(editada.branchId, entrada.branchId);

  const get = await call("GET", `/api/knowledge-base/${entrada.id}`, userA.accessToken);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), editada);
});

test("PATCH /api/knowledge-base/:id — sin campos es 400", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);

  const vacio = await call("PATCH", `/api/knowledge-base/${entrada.id}`, adminA.accessToken, {});
  assert.equal(vacio.status, 400);
  assert.match(await mensajeDeError(vacio), /al menos un campo/);
});

// ---------------------------------------------------------------------------
// 4. La sucursal SÍ se edita — la diferencia con Agent
// ---------------------------------------------------------------------------

test("PATCH /api/knowledge-base/:id — branchId SÍ es editable, a diferencia de Agent", async () => {
  // Título único: la sucursal por defecto de orgA la comparten los demás casos
  // de este archivo, y la aserción del final es "ya no está en la vieja".
  const titulo = `Mudable ${randomUUID().slice(0, 8)}`;
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, { title: titulo });
  const otraSucursal = await prisma.branch.create({
    data: { organizationId: orgA.id, name: `Mudanza ${randomUUID().slice(0, 8)}`, timezone: TZ },
  });

  // No hay ningún dato histórico denormalizado que dependa de la sucursal de
  // una entrada de KB (no existe el equivalente de Conversation.branchId), así
  // que no hay razón de integridad para impedir moverla.
  const mueve = await call("PATCH", `/api/knowledge-base/${entrada.id}`, adminA.accessToken, {
    branchId: otraSucursal.id,
  });
  assert.equal(mueve.status, 200, await mueve.text().catch(() => ""));

  const fila = await prisma.knowledgeBaseEntry.findUniqueOrThrow({
    where: { id: String(entrada.id) },
  });
  assert.equal(fila.branchId, otraSucursal.id, "debe haber cambiado de sucursal");

  // Y deja de aparecer en el prompt de la sucursal vieja, que es lo que mover
  // una entrada significa de verdad.
  const enLaVieja = await findActiveKnowledgeBaseEntriesByBranch(orgA.branchId, orgA.id);
  assert.ok(enLaVieja.every((e) => e.title !== fila.title));
});

test("PATCH con una sucursal AJENA, inexistente o borrada es 400 y no mueve nada", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);
  const borrada = await prisma.branch.create({
    data: {
      organizationId: orgA.id,
      name: "Cerrada",
      timezone: TZ,
      deletedAt: new Date(),
    },
  });

  for (const branchId of [orgB.branchId, randomUUID(), borrada.id]) {
    const res = await call("PATCH", `/api/knowledge-base/${entrada.id}`, adminA.accessToken, {
      branchId,
    });
    assert.equal(res.status, 400, `debía ser 400 para branchId ${branchId}`);
    assert.equal(
      await mensajeDeError(res),
      "La sucursal indicada no existe o no pertenece a tu organización",
    );
  }

  const fila = await prisma.knowledgeBaseEntry.findUniqueOrThrow({
    where: { id: String(entrada.id) },
  });
  assert.equal(fila.branchId, orgA.branchId, "no debe haberse movido");
});

// ---------------------------------------------------------------------------
// 1. Solo ADMIN escribe
// ---------------------------------------------------------------------------

test("USER recibe 403 en POST, PATCH y DELETE, y nada cambia", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);
  const antes = await prisma.knowledgeBaseEntry.count({ where: { organizationId: orgA.id } });

  const post = await call(
    "POST",
    "/api/knowledge-base",
    userA.accessToken,
    cuerpoMinimo(orgA.branchId),
  );
  assert.equal(post.status, 403);

  const patch = await call("PATCH", `/api/knowledge-base/${entrada.id}`, userA.accessToken, {
    title: "hijacked",
  });
  assert.equal(patch.status, 403);

  const del = await call("DELETE", `/api/knowledge-base/${entrada.id}`, userA.accessToken);
  assert.equal(del.status, 403);

  const despues = await prisma.knowledgeBaseEntry.count({ where: { organizationId: orgA.id } });
  assert.equal(despues, antes, "USER no debe haber creado nada");
  const fila = await prisma.knowledgeBaseEntry.findUniqueOrThrow({
    where: { id: String(entrada.id) },
  });
  assert.equal(fila.title, "Horarios");
  assert.equal(fila.deletedAt, null);
});

// ---------------------------------------------------------------------------
// 2. Aislamiento multi-tenant
// ---------------------------------------------------------------------------

test("la organización B no ve, no edita y no borra una entrada de la A", async () => {
  const deA = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId);

  // No aparece en el listado de B.
  const lista = await call("GET", "/api/knowledge-base?pageSize=100", adminB.accessToken);
  assert.equal(lista.status, 200);
  const { data } = (await lista.json()) as { data: Record<string, unknown>[] };
  assert.ok(
    data.every((e) => e.id !== deA.id),
    "la entrada de A no debe aparecer en el listado de B",
  );

  // 404 y no 403: B no tiene por qué enterarse de que ese id existe.
  const get = await call("GET", `/api/knowledge-base/${deA.id}`, adminB.accessToken);
  assert.equal(get.status, 404);

  const patch = await call("PATCH", `/api/knowledge-base/${deA.id}`, adminB.accessToken, {
    title: "hijacked",
  });
  assert.equal(patch.status, 404);

  const del = await call("DELETE", `/api/knowledge-base/${deA.id}`, adminB.accessToken);
  assert.equal(del.status, 404);

  const fila = await prisma.knowledgeBaseEntry.findUniqueOrThrow({
    where: { id: String(deA.id) },
  });
  assert.equal(fila.title, "Horarios", "B no debe haber editado nada");
  assert.equal(fila.deletedAt, null, "B no debe haber borrado nada");
});

// ---------------------------------------------------------------------------
// 3. Scoping por sucursal
// ---------------------------------------------------------------------------

test("POST con la sucursal de OTRA organización (o inexistente) es 400 y no crea nada", async () => {
  const antes = await prisma.knowledgeBaseEntry.count({ where: { organizationId: orgA.id } });

  const ajena = await call(
    "POST",
    "/api/knowledge-base",
    adminA.accessToken,
    cuerpoMinimo(orgB.branchId),
  );
  assert.equal(ajena.status, 400);
  assert.equal(
    await mensajeDeError(ajena),
    "La sucursal indicada no existe o no pertenece a tu organización",
  );

  const inexistente = await call(
    "POST",
    "/api/knowledge-base",
    adminA.accessToken,
    cuerpoMinimo(randomUUID()),
  );
  assert.equal(inexistente.status, 400);

  const despues = await prisma.knowledgeBaseEntry.count({ where: { organizationId: orgA.id } });
  assert.equal(despues, antes);
});

test("POST con una sucursal BORRADA de la propia organización es 400", async () => {
  const borrada = await prisma.branch.create({
    data: { organizationId: orgA.id, name: "Cerrada", timezone: TZ, deletedAt: new Date() },
  });

  const res = await call(
    "POST",
    "/api/knowledge-base",
    adminA.accessToken,
    cuerpoMinimo(borrada.id),
  );
  assert.equal(res.status, 400);
});

test("GET /api/knowledge-base?branchId= filtra por sucursal dentro de la organización", async () => {
  const norte = await prisma.branch.create({
    data: { organizationId: orgA.id, name: "Norte", timezone: TZ },
  });
  const enNorte = await crearEntradaPorHttp(adminA.accessToken, norte.id, { title: "Norte 1" });
  await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, { title: "Centro extra" });

  const res = await call("GET", `/api/knowledge-base?branchId=${norte.id}`, userA.accessToken);
  assert.equal(res.status, 200);
  const { data, pagination } = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { total: number };
  };
  assert.equal(pagination.total, 1);
  assert.equal(data[0].id, enNorte.id);

  // El branchId de otra organización no filtra nada de la nuestra: cero, no
  // un error — es un filtro, no una escritura.
  const ajeno = await call(
    "GET",
    `/api/knowledge-base?branchId=${orgB.branchId}`,
    userA.accessToken,
  );
  assert.equal(ajeno.status, 200);
  const cuerpoAjeno = (await ajeno.json()) as { pagination: { total: number } };
  assert.equal(cuerpoAjeno.pagination.total, 0);
});

// ---------------------------------------------------------------------------
// 5. Soft delete
// ---------------------------------------------------------------------------

test("DELETE marca deletedAt: el GET pasa a 404, el listado lo excluye, la fila sigue en la base", async () => {
  const entrada = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, {
    title: "Efímera",
  });

  const del = await call("DELETE", `/api/knowledge-base/${entrada.id}`, adminA.accessToken);
  assert.equal(del.status, 204);

  const get = await call("GET", `/api/knowledge-base/${entrada.id}`, adminA.accessToken);
  assert.equal(get.status, 404);

  const lista = await call("GET", "/api/knowledge-base?pageSize=100", adminA.accessToken);
  const { data } = (await lista.json()) as { data: Record<string, unknown>[] };
  assert.ok(
    data.every((e) => e.id !== entrada.id),
    "la borrada no debe listarse",
  );

  const fila = await prisma.knowledgeBaseEntry.findUniqueOrThrow({
    where: { id: String(entrada.id) },
  });
  assert.notEqual(fila.deletedAt, null, "soft delete, no borrado físico");

  // Borrar dos veces es 404: el segundo DELETE no encuentra nada vivo. Y un
  // PATCH sobre una borrada también — updateMany exige deletedAt: null.
  const otraVez = await call("DELETE", `/api/knowledge-base/${entrada.id}`, adminA.accessToken);
  assert.equal(otraVez.status, 404);
  const patch = await call("PATCH", `/api/knowledge-base/${entrada.id}`, adminA.accessToken, {
    title: "revivida",
  });
  assert.equal(patch.status, 404);
});

test("GET /api/knowledge-base?isActive=false lista solo las desactivadas (que no es lo mismo que borradas)", async () => {
  const inactiva = await crearEntradaPorHttp(adminA.accessToken, orgA.branchId, {
    title: "Apagada",
    isActive: false,
  });

  const res = await call(
    "GET",
    "/api/knowledge-base?isActive=false&pageSize=100",
    userA.accessToken,
  );
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as { data: Record<string, unknown>[] };
  assert.ok(data.some((e) => e.id === inactiva.id));
  assert.ok(data.every((e) => e.isActive === false && e.deletedAt === null));

  const invalido = await call("GET", "/api/knowledge-base?isActive=maybe", userA.accessToken);
  assert.equal(invalido.status, 400);
});

// ---------------------------------------------------------------------------
// 6. Lo que consume el loop del agente
//
// findActiveKnowledgeBaseEntriesByBranch es la ÚNICA lectura que arma el
// bloque del system prompt, y es donde vive todo el filtrado: el test unitario
// de armarSystemPrompt no tiene lógica de "esta entrada no va" justamente
// porque esa decisión termina acá. Por eso tiene su propio caso, contra
// Postgres real y en una sucursal propia.
// ---------------------------------------------------------------------------

test("findActiveKnowledgeBaseEntriesByBranch: solo activas, no borradas, de esa sucursal, por createdAt asc", async () => {
  const sucursal = await prisma.branch.create({
    data: { organizationId: orgA.id, name: `Prompt ${randomUUID().slice(0, 8)}`, timezone: TZ },
  });
  const otra = await prisma.branch.create({
    data: { organizationId: orgA.id, name: `Vecina ${randomUUID().slice(0, 8)}`, timezone: TZ },
  });

  // Se crean EN SERIE para que createdAt tenga un orden real que afirmar.
  const primera = await crearEntradaPorHttp(adminA.accessToken, sucursal.id, {
    title: "Primera",
    content: "Contenido de la primera.",
  });
  const segunda = await crearEntradaPorHttp(adminA.accessToken, sucursal.id, {
    title: "Segunda",
    content: "Contenido de la segunda.",
  });
  // Inactiva: existe y se lista, pero NO entra al prompt.
  await crearEntradaPorHttp(adminA.accessToken, sucursal.id, {
    title: "Inactiva",
    content: "No debería llegar al modelo.",
    isActive: false,
  });
  // Borrada: tampoco.
  const borrada = await crearEntradaPorHttp(adminA.accessToken, sucursal.id, {
    title: "Borrada",
    content: "Tampoco debería llegar al modelo.",
  });
  await call("DELETE", `/api/knowledge-base/${borrada.id}`, adminA.accessToken);
  // De otra sucursal de la MISMA organización: tampoco.
  await crearEntradaPorHttp(adminA.accessToken, otra.id, {
    title: "De la vecina",
    content: "Es de otra sucursal.",
  });

  const entradas = await findActiveKnowledgeBaseEntriesByBranch(sucursal.id, orgA.id);

  assert.deepEqual(entradas, [
    { title: String(primera.title), content: String(primera.content), sourceVehicleId: null },
    { title: String(segunda.title), content: String(segunda.content), sourceVehicleId: null },
  ]);

  // Y el aislamiento por organización también es de esta lectura, no solo del
  // CRUD: con el organizationId de B, la misma sucursal no devuelve nada.
  const conOrgAjena = await findActiveKnowledgeBaseEntriesByBranch(sucursal.id, orgB.id);
  assert.deepEqual(conOrgAjena, []);
});

// ---------------------------------------------------------------------------
// POST /api/knowledge-base/sync-vehicles — ítem 70.
//
// El service ya está probado contra Postgres en
// vehicleKnowledgeBaseSync.integration-test.ts: lo que se prueba ACÁ es el
// borde HTTP — permisos, validación del body y la forma de la respuesta.
// ---------------------------------------------------------------------------

// Una unidad publicada y disponible, escrita directo: qué hace falta para
// PODER publicar una ficha (assertCompleteForPublish y su foto) es una regla
// del alta de vehículos, no de este endpoint.
async function unidadPublicada(organizationId: string, branchId: string) {
  return prisma.vehicle.create({
    data: {
      organizationId,
      branchId,
      internalCode: `STK-${randomUUID().slice(0, 8)}`,
      condition: "USED",
      make: "Toyota",
      model: "Corolla",
      year: 2022,
      status: "AVAILABLE",
      publishOnWebsite: true,
      // De los que NUNCA pueden salir en el contenido generado: acá está para
      // afirmar por HTTP lo mismo que el test unitario de la allowlist.
      vin: "9BRZZZNOSALE0001",
    },
  });
}

test("POST /knowledge-base/sync-vehicles — un USER no sincroniza: 403 y no se crea nada", async () => {
  const vehiculo = await unidadPublicada(orgA.id, orgA.branchId);

  const res = await call("POST", "/api/knowledge-base/sync-vehicles", userA.accessToken, {
    branchId: orgA.branchId,
  });

  assert.equal(res.status, 403);
  const entradas = await prisma.knowledgeBaseEntry.count({
    where: { organizationId: orgA.id, sourceVehicleId: vehiculo.id },
  });
  assert.equal(entradas, 0);
});

test("POST /knowledge-base/sync-vehicles — una sucursal inexistente o ajena es 400", async () => {
  const inexistente = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {
    branchId: randomUUID(),
  });
  assert.equal(inexistente.status, 400);
  assert.match(await mensajeDeError(inexistente), /no existe o no pertenece/);

  // La de la otra organización: el mismo 400, sin confirmar que exista.
  const ajena = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {
    branchId: orgB.branchId,
  });
  assert.equal(ajena.status, 400);
  assert.match(await mensajeDeError(ajena), /no existe o no pertenece/);

  // Y un body sin branchId no llega ni al service.
  const sinBody = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {});
  assert.equal(sinBody.status, 400);
});

test("POST /knowledge-base/sync-vehicles — 200 con los tres conteos, y la entrada generada no filtra el VIN", async () => {
  // Sucursal propia de este caso: el resumen cuenta lo de ESA sucursal, y las
  // entradas que dejaron los demás casos viven en orgA.branchId.
  const sucursal = await prisma.branch.create({
    data: { organizationId: orgA.id, name: `Sync ${randomUUID().slice(0, 8)}`, timezone: TZ },
  });
  const vehiculo = await unidadPublicada(orgA.id, sucursal.id);

  const primera = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {
    branchId: sucursal.id,
  });
  assert.equal(primera.status, 200);
  assert.deepEqual(await primera.json(), { creadas: 1, actualizadas: 0, dadasDeBaja: 0 });

  const generada = await prisma.knowledgeBaseEntry.findFirstOrThrow({
    where: { organizationId: orgA.id, sourceVehicleId: vehiculo.id },
  });
  assert.equal(generada.branchId, sucursal.id);
  assert.ok(
    !generada.content.includes("9BRZZZNOSALE0001"),
    `el VIN no puede llegar al contenido: ${generada.content}`,
  );

  // Segunda corrida sin cambios: nada que hacer, y lo dice con ceros.
  const segunda = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {
    branchId: sucursal.id,
  });
  assert.deepEqual(await segunda.json(), { creadas: 0, actualizadas: 0, dadasDeBaja: 0 });

  // Se vende: la corrida siguiente la da de baja.
  await prisma.vehicle.update({ where: { id: vehiculo.id }, data: { status: "SOLD" } });
  const tercera = await call("POST", "/api/knowledge-base/sync-vehicles", adminA.accessToken, {
    branchId: sucursal.id,
  });
  assert.deepEqual(await tercera.json(), { creadas: 0, actualizadas: 0, dadasDeBaja: 1 });

  await prisma.knowledgeBaseEntry.deleteMany({ where: { branchId: sucursal.id } });
  await prisma.vehicle.deleteMany({ where: { branchId: sucursal.id } });
  await prisma.branch.delete({ where: { id: sucursal.id } });
});
