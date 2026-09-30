import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { createMetaPageConnectionRouter } from "../routes/metaPageConnection.routes";
import type { ClienteMetaOAuth, PaginaAutorizada } from "../services/metaOAuth.service";
import { getCifrador } from "../utils/encryption";
import { firmarMetaState } from "../utils/metaOauthState";

// ---------------------------------------------------------------------------
// /api/integrations/meta (ítem 170) por HTTP real, contra Postgres y GoTrue
// reales, con LA MISMA cadena del router (authenticate, rate limiter,
// authorize) vía su factory, y un doble del cliente OAuth de Meta: nunca se
// habla con Meta.
//
// Lo que este archivo fija:
//   1. Permisos: sin token 401 en los tres endpoints ADMIN; un USER lee (GET)
//      pero recibe 403 en conectar y desconectar.
//   2. Conectar devuelve la URL de Meta con un state firmado para la
//      organización del JWT.
//   3. El callback, SIN JWT, con un state real: deja la fila de
//      MetaPageConnection ACTIVE, con el token CIFRADO, en la organización
//      que salió del state; reconectar actualiza, no duplica. Desde el ítem
//      173 responde un 302 a /organization con ?metaConnected=true o
//      ?metaError=<mensaje> (CORS_ORIGIN se fija acá para no depender del
//      entorno).
//   4. El token nunca sale por el GET.
//   5. Una página ya conectada a OTRA organización → error, y la fila de la
//      otra no cambia.
//   6. Cero y varias páginas → error legible sin fila.
//   7. Desconectar deja REVOKED sin token; otra vez es 409.
// ---------------------------------------------------------------------------

const PASSWORD = "Meta-oauth-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let orgA: string;
let orgB: string;
let adminA: FixtureUser;
let userA: FixtureUser;
let adminB: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;
const CORS_ORIGIN_DE_TEST = "http://localhost:5173";
const corsOriginOriginal = env.CORS_ORIGIN;

// El doble de Meta: devuelve las páginas que cada test le pida.
let paginasEnMeta: PaginaAutorizada[] = [];
let codesCanjeados: string[] = [];
let paginasSuscriptas: string[] = [];

const cliente: ClienteMetaOAuth = {
  construirUrlDeAutorizacion: (state) =>
    `https://www.facebook.com/v25.0/dialog/oauth?state=${encodeURIComponent(state)}`,
  intercambiarCodigo: async (code) => {
    codesCanjeados.push(code);
    return { accessToken: "user-corto", expiraEnSegundos: 3600 };
  },
  obtenerTokenDeLargaDuracion: async () => ({
    accessToken: "user-largo",
    expiraEnSegundos: 5183944,
  }),
  listarPaginasAutorizadas: async () => paginasEnMeta,
  // Ítem 171: la suscripción de la página. Registra a quién se suscribió.
  suscribirPaginaALaApp: async (pageId) => {
    paginasSuscriptas.push(pageId);
  },
};

// page_id es UNIQUE en toda la tabla: uno al azar por caso.
function pageIdAlAzar(): string {
  return String(randomInt(100_000_000, 999_999_999)) + String(randomInt(100_000, 999_999));
}

function pagina(id = pageIdAlAzar(), instagram: string | null = null): PaginaAutorizada {
  return {
    id,
    name: `Página ${id}`,
    accessToken: `page-token-${id}`,
    instagramBusinessAccountId: instagram,
  };
}

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createMetaPageConnectionRouter(cliente));
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
      name: `Meta OAuth ${etiqueta} ${randomUUID()}`,
      slug: `meta-oauth-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `meta-oauth-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      fullName: `Meta OAuth ${label}`,
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

function call(method: string, path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

// El callback lo golpea el NAVEGADOR, sin JWT. Siempre sin header.
// redirect: "manual": el 302 apunta al frontend, que en el test no existe.
async function callback(organizationId: string, extra = "&code=el-code"): Promise<Response> {
  const state = await firmarMetaState({ organizationId });
  return fetch(
    `${baseUrl}/api/integrations/meta/callback?state=${encodeURIComponent(state)}${extra}`,
    { redirect: "manual" },
  );
}

// La vuelta al frontend (ítem 173): siempre un 302 a /organization.
function vuelta(res: Response): URL {
  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.origin, CORS_ORIGIN_DE_TEST);
  assert.equal(destino.pathname, "/organization");
  return destino;
}

function exito(res: Response): void {
  assert.equal(vuelta(res).searchParams.get("metaConnected"), "true");
}

function mensajeDeError(res: Response): string {
  return vuelta(res).searchParams.get("metaError") ?? "";
}

function conexionDe(organizationId: string) {
  return prisma.metaPageConnection.findUnique({ where: { organizationId } });
}

beforeEach(async () => {
  paginasEnMeta = [pagina()];
  codesCanjeados = [];
  paginasSuscriptas = [];
  if (orgA && orgB) {
    await prisma.metaPageConnection.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  }
});

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  env.CORS_ORIGIN = CORS_ORIGIN_DE_TEST;
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  adminA = await createFixtureUser("admin-a", orgA, "ADMIN");
  userA = await createFixtureUser("user-a", orgA, "USER");
  adminB = await createFixtureUser("admin-b", orgB, "ADMIN");
});

after(async () => {
  env.CORS_ORIGIN = corsOriginOriginal;
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.metaPageConnection.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [adminA, userA, adminB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

test("sin token: 401 en los tres endpoints administrativos", async () => {
  for (const [method, path] of [
    ["GET", "/api/integrations/meta"],
    ["POST", "/api/integrations/meta/connect"],
    ["DELETE", "/api/integrations/meta"],
  ]) {
    const res = await call(method, path);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("un USER lee el estado (404 si no hay conexión) pero recibe 403 al conectar y al desconectar", async () => {
  const get = await call("GET", "/api/integrations/meta", userA.accessToken);
  assert.equal(get.status, 404);

  const conectar = await call("POST", "/api/integrations/meta/connect", userA.accessToken);
  assert.equal(conectar.status, 403);

  const desconectar = await call("DELETE", "/api/integrations/meta", userA.accessToken);
  assert.equal(desconectar.status, 403);
});

test("un ADMIN conecta: 200 con la URL de Meta y un state firmado para SU organización", async () => {
  const res = await call("POST", "/api/integrations/meta/connect", adminA.accessToken);
  assert.equal(res.status, 200);

  const { authorizationUrl } = (await res.json()) as { authorizationUrl: string };
  const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
  const payload = JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.organizationId, orgA);
  assert.equal(payload.aud, "meta-oauth");
});

// ---------------------------------------------------------------------------
// El callback
// ---------------------------------------------------------------------------

test("el callback, sin JWT y con un state real, deja la fila ACTIVE con el token cifrado en la organización del state", async () => {
  const unaPagina = pagina(pageIdAlAzar(), "17841400000000001");
  paginasEnMeta = [unaPagina];

  exito(await callback(orgA));
  assert.deepEqual(codesCanjeados, ["el-code"]);
  // Ítem 171: la página quedó suscripta al webhook de la app.
  assert.deepEqual(paginasSuscriptas, [unaPagina.id]);

  const fila = await conexionDe(orgA);
  assert.ok(fila);
  assert.equal(fila.status, "ACTIVE");
  assert.equal(fila.pageId, unaPagina.id);
  assert.equal(fila.instagramBusinessAccountId, "17841400000000001");
  assert.ok(fila.pageAccessToken);
  assert.notEqual(fila.pageAccessToken, unaPagina.accessToken);
  assert.equal(getCifrador().decrypt(fila.pageAccessToken), unaPagina.accessToken);

  // La otra organización no se tocó.
  assert.equal(await conexionDe(orgB), null);
});

test("el GET devuelve la conexión sin el token", async () => {
  await callback(orgA);

  const res = await call("GET", "/api/integrations/meta", userA.accessToken);
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as Record<string, unknown>;
  assert.equal(cuerpo.organizationId, orgA);
  assert.equal(cuerpo.status, "ACTIVE");
  assert.equal("pageAccessToken" in cuerpo, false);
});

test("reconectar ACTUALIZA la fila (otra página), no crea una segunda", async () => {
  await callback(orgA);
  const primera = await conexionDe(orgA);

  const nueva = pagina();
  paginasEnMeta = [nueva];
  exito(await callback(orgA));

  const filas = await prisma.metaPageConnection.findMany({ where: { organizationId: orgA } });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, primera?.id);
  assert.equal(filas[0].pageId, nueva.id);
});

test("una página ya conectada a OTRA organización → vuelve con el error, y la conexión de la otra no cambia", async () => {
  const compartida = pagina();
  paginasEnMeta = [compartida];
  exito(await callback(orgB));

  assert.match(mensajeDeError(await callback(orgA)), /ya está conectada a otra cuenta/);

  assert.equal(await conexionDe(orgA), null);
  assert.equal((await conexionDe(orgB))?.pageId, compartida.id);
});

test("cero páginas autorizadas → error legible y sin fila", async () => {
  paginasEnMeta = [];
  assert.match(mensajeDeError(await callback(orgA)), /No autorizaste ninguna página/);
  assert.equal(await conexionDe(orgA), null);
});

test("más de una página autorizada → error legible y sin fila", async () => {
  paginasEnMeta = [pagina(), pagina()];
  assert.match(mensajeDeError(await callback(orgA)), /más de una página/);
  assert.equal(await conexionDe(orgA), null);
});

test("la persona cancela en Meta (error=access_denied) → vuelve con el error, sin canjear nada ni escribir", async () => {
  const res = await callback(orgA, "&error=access_denied&error_reason=user_denied");
  assert.match(mensajeDeError(res), /Se canceló la autorización en Facebook/);
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
});

test("un state manipulado no escribe en ninguna organización", async () => {
  const state = await firmarMetaState({ organizationId: orgA });
  const [header, payload, firma] = state.split(".");
  const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  alterado.organizationId = orgB;
  const falso = [header, Buffer.from(JSON.stringify(alterado)).toString("base64url"), firma].join(
    ".",
  );

  const res = await fetch(
    `${baseUrl}/api/integrations/meta/callback?state=${encodeURIComponent(falso)}&code=x`,
    { redirect: "manual" },
  );
  assert.notEqual(mensajeDeError(res), "");
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
  assert.equal(await conexionDe(orgB), null);
});

// ---------------------------------------------------------------------------
// Desconectar
// ---------------------------------------------------------------------------

test("un ADMIN desconecta: 204, la fila queda REVOKED sin token; otra vez es 409", async () => {
  await callback(orgA);

  const res = await call("DELETE", "/api/integrations/meta", adminA.accessToken);
  assert.equal(res.status, 204);

  const fila = await conexionDe(orgA);
  assert.equal(fila?.status, "REVOKED");
  assert.equal(fila?.pageAccessToken, null);

  const otra = await call("DELETE", "/api/integrations/meta", adminA.accessToken);
  assert.equal(otra.status, 409);
});

// D-10 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): con el UNIQUE global de page_id, la página que B desconectó (fila
// REVOKED) no la podía conectar nadie más, nunca. Ahora el UNIQUE es parcial.
test("D-10: la página que otra organización desconectó se puede conectar; mientras esté conectada, vuelve a ser 409", async () => {
  const compartida = pagina();
  paginasEnMeta = [compartida];
  exito(await callback(orgB));
  assert.equal((await call("DELETE", "/api/integrations/meta", adminB.accessToken)).status, 204);

  exito(await callback(orgA));
  const deA = await conexionDe(orgA);
  assert.equal(deA?.pageId, compartida.id);
  assert.equal(deA?.status, "ACTIVE");

  // B reconecta la misma página mientras A la tiene: la fila revocada de B
  // pasaría a ACTIVE con la página de A, y eso sigue siendo imposible.
  assert.match(mensajeDeError(await callback(orgB)), /ya está conectada a otra cuenta/);
  assert.equal((await conexionDe(orgB))?.status, "REVOKED");
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});

test("desconectar sin conexión → 404; el ADMIN de otra organización no toca la de A", async () => {
  assert.equal((await call("DELETE", "/api/integrations/meta", adminA.accessToken)).status, 404);

  await callback(orgA);
  assert.equal((await call("DELETE", "/api/integrations/meta", adminB.accessToken)).status, 404);
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});
