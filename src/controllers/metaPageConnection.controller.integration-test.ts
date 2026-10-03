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
import {
  MetaAuthError,
  type ClienteMetaOAuth,
  type PaginaAutorizada,
} from "../services/metaOAuth.service";
import {
  MENSAJE_CODE_VENCIDO,
  MENSAJE_OTRA_SESION,
  MENSAJE_STATE_YA_USADO,
} from "../services/metaPageConnection.service";
import { getCifrador } from "../utils/encryption";
import { firmarMetaState } from "../utils/metaOauthState";
import { RUTA_DE_VUELTA } from "./metaPageConnection.controller";

// ---------------------------------------------------------------------------
// La conexión con Facebook (ítem 170) por HTTP real, contra Postgres y GoTrue
// reales, con LA MISMA cadena del router (authenticate, rate limiter,
// requirePlatformAdmin) vía su factory, y un doble del cliente OAuth de Meta:
// nunca se habla con Meta.
//
// Desde el 02/10/2026 conectar, completar y desconectar son de PLATFORM ADMIN,
// sobre una organización elegida (/api/admin/organizations/:id/integrations/meta);
// el tenant solo lee el estado de la suya (GET /api/integrations/meta).
//
// Lo que este archivo fija:
//   1. Permisos: sin token 401; un ADMIN de tenant (y un USER) recibe 403 en
//      las cuatro rutas de plataforma, y las rutas viejas de escritura del
//      tenant ya no existen (404). El tenant lee el estado de la suya.
//   2. Conectar devuelve la URL de Meta con un state firmado para la
//      organización del PATH y el platform admin que la pidió.
//   3. El callback, SIN JWT, solo rebota a la pantalla de plataforma con el
//      code y el state en el fragmento (A-07) y la organización en la query,
//      o con ?metaError=<mensaje> (CORS_ORIGIN se fija acá para no depender
//      del entorno). Completar (POST /complete, con la sesión de quien
//      empezó) deja la fila ACTIVE en la organización elegida, con el token
//      CIFRADO; reconectar actualiza, no duplica. Otra sesión, el state de
//      otra organización, un state ya usado o un code vencido → error claro y
//      nada escrito.
//   4. El token nunca sale por el GET.
//   5. Una página ya conectada a OTRA organización → error, y la fila de la
//      otra no cambia.
//   6. Cero y varias páginas → error legible sin fila.
//   7. Desconectar da de baja la suscripción en Meta (D-11) y deja REVOKED
//      sin token; otra vez es 409.
// ---------------------------------------------------------------------------

const PASSWORD = "Meta-oauth-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let orgA: string;
let orgB: string;
// La organización propia del platform admin: NO es la que configura.
let orgP: string;
let adminA: FixtureUser;
let userA: FixtureUser;
let adminB: FixtureUser;
// Los platform admins: el que conecta y otro, para A-07 (otra sesión).
let plataforma: FixtureUser;
let plataforma2: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;
const CORS_ORIGIN_DE_TEST = "http://localhost:5173";
const corsOriginOriginal = env.CORS_ORIGIN;

// El doble de Meta: devuelve las páginas que cada test le pida.
let paginasEnMeta: PaginaAutorizada[] = [];
let codesCanjeados: string[] = [];
let paginasSuscriptas: string[] = [];
let paginasDesuscriptas: string[] = [];
// El code que el doble de Meta rechaza como vencido (A-07).
const CODE_VENCIDO = "code-vencido";

const cliente: ClienteMetaOAuth = {
  construirUrlDeAutorizacion: (state) =>
    `https://www.facebook.com/v25.0/dialog/oauth?state=${encodeURIComponent(state)}`,
  intercambiarCodigo: async (code) => {
    if (code === CODE_VENCIDO) {
      throw new MetaAuthError("Meta rechazó la solicitud: code vencido", true);
    }
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
  // D-11: la baja al desconectar. Registra página y token (ya descifrado).
  desuscribirPaginaDeLaApp: async (pageId, pageAccessToken) => {
    paginasDesuscriptas.push(`${pageId}:${pageAccessToken}`);
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

function call(method: string, path: string, token?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// El callback lo golpea el NAVEGADOR, sin JWT. Desde A-07 solo rebota al CRM.
// redirect: "manual": el 302 apunta al frontend, que en el test no existe.
function golpearCallback(query: string): Promise<Response> {
  return fetch(`${baseUrl}/api/integrations/meta/callback${query}`, { redirect: "manual" });
}

function rutaAdmin(organizationId: string, sufijo = ""): string {
  return `/api/admin/organizations/${organizationId}/integrations/meta${sufijo}`;
}

// El segundo tramo (A-07): el CRM, con la sesión de `quien`, manda el code y
// el state a la ruta de `organizationId`. `firmante` es quien tocó
// "Conectar" (por defecto, el mismo); el state se firma para la misma
// organización de la ruta salvo que se pase uno armado.
async function completar(
  organizationId: string,
  quien: FixtureUser,
  opciones: { code?: string; firmante?: FixtureUser; state?: string } = {},
): Promise<Response> {
  const state =
    opciones.state ??
    (await firmarMetaState({
      organizationId,
      userId: (opciones.firmante ?? quien).authUserId,
    }));
  return call("POST", rutaAdmin(organizationId, "/complete"), quien.accessToken, {
    state,
    code: opciones.code ?? "el-code",
  });
}

// El platform admin conecta la organización elegida.
function conectar(organizationId: string, extra: { code?: string } = {}): Promise<Response> {
  return completar(organizationId, plataforma, extra);
}

function desconectar(organizationId: string, quien: FixtureUser = plataforma): Promise<Response> {
  return call("DELETE", rutaAdmin(organizationId), quien.accessToken);
}

async function exito(res: Response): Promise<void> {
  const crudo = await res.text();
  assert.equal(res.status, 200, crudo);
}

async function mensajeDeError(res: Response): Promise<string> {
  assert.notEqual(res.status, 200);
  const cuerpo = (await res.json()) as { error: { message: string } };
  return cuerpo.error.message;
}

function conexionDe(organizationId: string) {
  return prisma.metaPageConnection.findUnique({ where: { organizationId } });
}

beforeEach(async () => {
  paginasEnMeta = [pagina()];
  codesCanjeados = [];
  paginasSuscriptas = [];
  paginasDesuscriptas = [];
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
  orgP = await crearOrganizacion("p");
  adminA = await createFixtureUser("admin-a", orgA, "ADMIN");
  userA = await createFixtureUser("user-a", orgA, "USER");
  adminB = await createFixtureUser("admin-b", orgB, "ADMIN");
  // Con rol USER en su propia organización a propósito: lo que lo habilita es
  // la allowlist global, no el rol (ver requirePlatformAdmin).
  plataforma = await createFixtureUser("plataforma", orgP, "USER");
  plataforma2 = await createFixtureUser("plataforma-2", orgP, "USER");
  for (const pa of [plataforma, plataforma2]) {
    await prisma.platformAdmin.create({ data: { userId: pa.authUserId } });
  }
});

after(async () => {
  env.CORS_ORIGIN = corsOriginOriginal;
  if (closeApp) await closeApp();
  for (const pa of [plataforma, plataforma2]) {
    if (pa) await prisma.platformAdmin.deleteMany({ where: { userId: pa.authUserId } });
  }
  for (const org of [orgA, orgB, orgP]) {
    if (!org) continue;
    await prisma.metaPageConnection.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [adminA, userA, adminB, plataforma, plataforma2]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

test("sin token: 401 en la lectura del tenant y en las cuatro rutas de plataforma", async () => {
  for (const [method, path] of [
    ["GET", "/api/integrations/meta"],
    ["GET", rutaAdmin(orgA)],
    ["POST", rutaAdmin(orgA, "/connect")],
    ["POST", rutaAdmin(orgA, "/complete")],
    ["DELETE", rutaAdmin(orgA)],
  ]) {
    const res = await call(method, path);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

// 02/10/2026: el ADMIN del negocio ya no conecta ni desconecta. Ni por las
// rutas de plataforma (403: no está en la allowlist), ni sobre su propia
// organización, ni por las rutas viejas (ya no existen).
test("un ADMIN de tenant (y un USER) recibe 403 en connect, complete, delete y el GET de plataforma, aun sobre SU organización", async () => {
  await exito(await conectar(orgA));

  for (const quien of [adminA, userA]) {
    assert.equal((await call("GET", rutaAdmin(orgA), quien.accessToken)).status, 403);
    assert.equal((await call("POST", rutaAdmin(orgA, "/connect"), quien.accessToken)).status, 403);
    // Un state firmado para él mismo y su organización tampoco le sirve.
    assert.equal((await completar(orgA, quien)).status, 403);
    assert.equal((await desconectar(orgA, quien)).status, 403);
  }

  assert.deepEqual(codesCanjeados, ["el-code"]);
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
  assert.deepEqual(paginasDesuscriptas, []);
});

test("las rutas viejas de escritura del tenant ya no existen: 404 aun con la sesión de un ADMIN", async () => {
  await exito(await conectar(orgA));

  for (const [method, path] of [
    ["POST", "/api/integrations/meta/connect"],
    ["POST", "/api/integrations/meta/complete"],
    ["DELETE", "/api/integrations/meta"],
  ]) {
    const res = await call(method, path, adminA.accessToken, {});
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});

test("el tenant lee el estado de SU organización (404 si no hay conexión), sin el token", async () => {
  assert.equal((await call("GET", "/api/integrations/meta", userA.accessToken)).status, 404);

  await exito(await conectar(orgA));

  const res = await call("GET", "/api/integrations/meta", userA.accessToken);
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as Record<string, unknown>;
  assert.equal(cuerpo.organizationId, orgA);
  assert.equal(cuerpo.status, "ACTIVE");
  assert.equal("pageAccessToken" in cuerpo, false);

  // La otra organización no ve la de A.
  assert.equal((await call("GET", "/api/integrations/meta", adminB.accessToken)).status, 404);
});

test("el platform admin lee el estado de la organización elegida, sin el token", async () => {
  assert.equal((await call("GET", rutaAdmin(orgA), plataforma.accessToken)).status, 404);

  await exito(await conectar(orgA));

  const res = await call("GET", rutaAdmin(orgA), plataforma.accessToken);
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as Record<string, unknown>;
  assert.equal(cuerpo.organizationId, orgA);
  assert.equal("pageAccessToken" in cuerpo, false);
  assert.equal((await call("GET", rutaAdmin(orgB), plataforma.accessToken)).status, 404);
});

test("un organizationId que no es un uuid → 400", async () => {
  const res = await call("POST", rutaAdmin("no-es-uuid", "/connect"), plataforma.accessToken);
  assert.equal(res.status, 400);
});

test("el platform admin conecta: 200 con la URL de Meta y un state firmado para la organización ELEGIDA y SU usuario", async () => {
  const res = await call("POST", rutaAdmin(orgA, "/connect"), plataforma.accessToken);
  assert.equal(res.status, 200);

  const { authorizationUrl } = (await res.json()) as { authorizationUrl: string };
  const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
  const payload = JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString("utf8"));
  // La del path, no la propia del platform admin (orgP).
  assert.equal(payload.organizationId, orgA);
  assert.equal(payload.userId, plataforma.authUserId);
  assert.equal(typeof payload.jti, "string");
  assert.equal(payload.aud, "meta-oauth");
});

test("conectar una organización que no existe → 404", async () => {
  const res = await call("POST", rutaAdmin(randomUUID(), "/connect"), plataforma.accessToken);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// El callback (A-07: solo rebota)
// ---------------------------------------------------------------------------

test("A-07: el callback, sin JWT, rebota a la pantalla de plataforma con la organización, y el code y el state en el fragmento, sin canjear ni escribir", async () => {
  const state = await firmarMetaState({ organizationId: orgA, userId: plataforma.authUserId });

  const res = await golpearCallback(`?state=${encodeURIComponent(state)}&code=el-code`);

  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.origin, CORS_ORIGIN_DE_TEST);
  assert.equal(destino.pathname, RUTA_DE_VUELTA);
  assert.equal(destino.searchParams.get("organizationId"), orgA);
  const fragmento = new URLSearchParams(destino.hash.slice(1));
  assert.equal(fragmento.get("metaCode"), "el-code");
  assert.equal(fragmento.get("metaState"), state);

  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
});

test("la persona cancela en Meta (error=access_denied) → vuelve con el error, sin canjear nada ni escribir", async () => {
  const res = await golpearCallback("?state=x&error=access_denied&error_reason=user_denied");
  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location") ?? "");
  assert.equal(destino.pathname, RUTA_DE_VUELTA);
  assert.match(destino.searchParams.get("metaError") ?? "", /Se canceló la autorización/);
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
});

// ---------------------------------------------------------------------------
// Completar
// ---------------------------------------------------------------------------

test("completar, con la sesión del platform admin que empezó, deja la fila ACTIVE con el token cifrado en la organización ELEGIDA", async () => {
  const unaPagina = pagina(pageIdAlAzar(), "17841400000000001");
  paginasEnMeta = [unaPagina];

  await exito(await conectar(orgA));
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

  // Ni la otra organización ni la propia del platform admin se tocaron.
  assert.equal(await conexionDe(orgB), null);
  assert.equal(await conexionDe(orgP), null);
});

// A-07 de docs-privados/auditoria-2026-09-30-corta.md (local): el que termina
// el flujo no es el que lo empezó → 403 con un mensaje que dice qué hacer.
test("A-07: completar con OTRA sesión de platform admin → 403 claro y nada escrito; el dueño del state lo termina", async () => {
  const state = await firmarMetaState({ organizationId: orgA, userId: plataforma.authUserId });

  const res = await completar(orgA, plataforma2, { state });
  assert.equal(res.status, 403);
  assert.equal(await mensajeDeError(res), MENSAJE_OTRA_SESION);
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);

  await exito(await completar(orgA, plataforma, { state }));
});

test("el state de una organización no sirve para completar otra → 403 claro y nada escrito en ninguna", async () => {
  const state = await firmarMetaState({ organizationId: orgA, userId: plataforma.authUserId });

  const res = await completar(orgB, plataforma, { state });
  assert.equal(res.status, 403);
  assert.equal(await mensajeDeError(res), MENSAJE_OTRA_SESION);
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
  assert.equal(await conexionDe(orgB), null);

  // No se consumió: en su organización sigue sirviendo.
  await exito(await completar(orgA, plataforma, { state }));
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});

test("A-07: el mismo state sirve una sola vez → el segundo intento es 400 claro, sin volver a canjear", async () => {
  const state = await firmarMetaState({ organizationId: orgA, userId: plataforma.authUserId });

  await exito(await completar(orgA, plataforma, { state }));
  const otra = await completar(orgA, plataforma, { state });

  assert.equal(otra.status, 400);
  assert.equal(await mensajeDeError(otra), MENSAJE_STATE_YA_USADO);
  assert.deepEqual(codesCanjeados, ["el-code"]);
});

test("A-07: Meta rechaza el code (vencido o ya canjeado) → 400 con el mensaje para reintentar, y sin fila", async () => {
  const res = await conectar(orgA, { code: CODE_VENCIDO });
  assert.equal(res.status, 400);
  assert.equal(await mensajeDeError(res), MENSAJE_CODE_VENCIDO);
  assert.equal(await conexionDe(orgA), null);
});

test("un state manipulado no escribe en ninguna organización", async () => {
  const state = await firmarMetaState({ organizationId: orgA, userId: plataforma2.authUserId });
  const [header, payload, firma] = state.split(".");
  const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  alterado.organizationId = orgB;
  alterado.userId = plataforma.authUserId;
  const falso = [header, Buffer.from(JSON.stringify(alterado)).toString("base64url"), firma].join(
    ".",
  );

  const res = await completar(orgB, plataforma, { state: falso });
  assert.equal(res.status, 400);
  assert.equal(codesCanjeados.length, 0);
  assert.equal(await conexionDe(orgA), null);
  assert.equal(await conexionDe(orgB), null);
});

test("reconectar ACTUALIZA la fila (otra página), no crea una segunda", async () => {
  await exito(await conectar(orgA));
  const primera = await conexionDe(orgA);

  const nueva = pagina();
  paginasEnMeta = [nueva];
  await exito(await conectar(orgA));

  const filas = await prisma.metaPageConnection.findMany({ where: { organizationId: orgA } });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, primera?.id);
  assert.equal(filas[0].pageId, nueva.id);
});

test("una página ya conectada a OTRA organización → error, y la conexión de la otra no cambia", async () => {
  const compartida = pagina();
  paginasEnMeta = [compartida];
  await exito(await conectar(orgB));

  assert.match(await mensajeDeError(await conectar(orgA)), /ya está conectada a otra cuenta/);

  assert.equal(await conexionDe(orgA), null);
  assert.equal((await conexionDe(orgB))?.pageId, compartida.id);
});

test("cero páginas autorizadas → error legible y sin fila", async () => {
  paginasEnMeta = [];
  assert.match(await mensajeDeError(await conectar(orgA)), /No autorizaste ninguna página/);
  assert.equal(await conexionDe(orgA), null);
});

test("más de una página autorizada → error legible y sin fila", async () => {
  paginasEnMeta = [pagina(), pagina()];
  assert.match(await mensajeDeError(await conectar(orgA)), /más de una página/);
  assert.equal(await conexionDe(orgA), null);
});

// ---------------------------------------------------------------------------
// Desconectar
// ---------------------------------------------------------------------------

test("D-11: el platform admin desconecta: se da de baja la suscripción en Meta, 204, la fila queda REVOKED sin token; otra vez es 409", async () => {
  const unaPagina = pagina();
  paginasEnMeta = [unaPagina];
  await exito(await conectar(orgA));

  const res = await desconectar(orgA);
  assert.equal(res.status, 204);
  assert.deepEqual(paginasDesuscriptas, [`${unaPagina.id}:${unaPagina.accessToken}`]);

  const fila = await conexionDe(orgA);
  assert.equal(fila?.status, "REVOKED");
  assert.equal(fila?.pageAccessToken, null);

  const otra = await desconectar(orgA);
  assert.equal(otra.status, 409);
});

// D-10 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): con el UNIQUE global de page_id, la página que B desconectó (fila
// REVOKED) no la podía conectar nadie más, nunca. Ahora el UNIQUE es parcial.
test("D-10: la página que otra organización desconectó se puede conectar; mientras esté conectada, vuelve a ser 409", async () => {
  const compartida = pagina();
  paginasEnMeta = [compartida];
  await exito(await conectar(orgB));
  assert.equal((await desconectar(orgB)).status, 204);

  await exito(await conectar(orgA));
  const deA = await conexionDe(orgA);
  assert.equal(deA?.pageId, compartida.id);
  assert.equal(deA?.status, "ACTIVE");

  // B reconecta la misma página mientras A la tiene: la fila revocada de B
  // pasaría a ACTIVE con la página de A, y eso sigue siendo imposible.
  assert.match(await mensajeDeError(await conectar(orgB)), /ya está conectada a otra cuenta/);
  assert.equal((await conexionDe(orgB))?.status, "REVOKED");
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});

test("desconectar sin conexión → 404; desconectar B no toca la de A", async () => {
  assert.equal((await desconectar(orgA)).status, 404);

  await exito(await conectar(orgA));
  assert.equal((await desconectar(orgB)).status, 404);
  assert.equal((await conexionDe(orgA))?.status, "ACTIVE");
});
