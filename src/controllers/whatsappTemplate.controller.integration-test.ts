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
import { createWhatsappTemplateRouter } from "../routes/whatsappTemplate.routes";
import {
  WhatsappGraphError,
  type CreateWhatsappTemplateInput,
  type DeleteWhatsappTemplateInput,
} from "../services/whatsappGraph.service";
import type { DepsDePlantillas } from "../services/whatsappTemplate.service";

// ---------------------------------------------------------------------------
// /api/whatsapp-templates (ítem 160) por HTTP real, contra Postgres y GoTrue
// reales, con LA MISMA cadena del router (authenticate, rate limiter,
// authorize) vía su factory, y un doble de la Graph API de Meta: nunca se
// habla con Meta.
//
// Lo que este archivo fija:
//   1. Solo ADMIN, incluida la lectura: USER recibe 403 y nada cambia.
//   2. El alta: valida el texto ANTES de tocar Meta (400 sin llamada), manda
//      a Meta el cuerpo traducido a {{1}}/{{2}} con categoría UTILITY, y
//      guarda la fila en PENDING con el id de Meta.
//   3. Una activa por organización: con una PENDING/APPROVED, otro alta es
//      409 sin llamar a Meta; con una REJECTED, el alta la reemplaza (la
//      borra en Meta y localmente).
//   4. El nombre es único en TODA la tabla (WABA compartido): otra
//      organización con el mismo nombre es 409; borrar la libera.
//   5. Si Meta rechaza o no contesta el alta, la reserva se descarta: 400 con
//      el motivo de Meta / 502, y ninguna fila queda ocupando el lugar.
//   6. Refresh: repregunta a Meta y guarda el estado traducido.
//   7. Borrado: en Meta (por nombre + id) y soft delete local; si Meta dice
//      que ya no existe, se borra igual localmente.
//   8. Aislamiento: la organización B no ve, no refresca y no borra la de A.
//   9. Sin WHATSAPP_BUSINESS_ACCOUNT_ID: 503 con un mensaje para el negocio.
// ---------------------------------------------------------------------------

const PASSWORD = "Whatsapp-template-test-password-123!";

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

// El doble de Meta. Registra cada llamada; `fallaAlCrear`/`fallaAlBorrar`
// simulan lo que Meta contestaría, y `estadoEnMeta` es lo que devuelve el
// refresh.
let altas: CreateWhatsappTemplateInput[] = [];
let bajas: DeleteWhatsappTemplateInput[] = [];
let fallaAlCrear: unknown = null;
let fallaAlBorrar: unknown = null;
let estadoEnMeta = { status: "APPROVED", rejectedReason: null as string | null };
let wabaConfigurado: string | undefined = "waba-de-prueba";

const deps: DepsDePlantillas = {
  wabaId: () => wabaConfigurado,
  accessToken: () => "token-de-prueba",
  create: (input) => {
    altas.push(input);
    if (fallaAlCrear) return Promise.reject(fallaAlCrear);
    return Promise.resolve({ id: String(randomInt(1_000_000, 9_999_999)), status: "PENDING" });
  },
  delete: (input) => {
    bajas.push(input);
    return fallaAlBorrar ? Promise.reject(fallaAlBorrar) : Promise.resolve();
  },
  getStatus: () => Promise.resolve(estadoEnMeta),
};

// El nombre es único en toda la tabla: uno al azar por corrida y por caso.
function nombreAlAzar(etiqueta: string) {
  return `test_${etiqueta}_${String(randomInt(100_000_000, 999_999_999))}`;
}

const TEXTO = "Hola {nombre}, gracias por tu compra. Tu opinión acá: {link} ¡Gracias!";

function cuerpo(extra: Record<string, unknown> = {}) {
  return { name: nombreAlAzar("alta"), language: "es_AR", bodyText: TEXTO, ...extra };
}

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createWhatsappTemplateRouter(deps));
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
      name: `WhatsApp templates ${etiqueta} ${randomUUID()}`,
      slug: `wa-templates-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `wa-templates-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      fullName: `WhatsApp templates ${label}`,
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

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

async function crearPorHttp(token: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/whatsapp-templates", token, cuerpo(extra));
  const crudo = await res.text();
  assert.equal(res.status, 201, `no se pudo crear la plantilla: ${crudo}`);
  return JSON.parse(crudo) as { id: string; name: string; status: string };
}

function activasDe(organizationId: string) {
  return prisma.whatsappTemplate.findMany({ where: { organizationId, deletedAt: null } });
}

// Cada caso arranca sin plantilla activa en ninguna de las dos organizaciones
// (se limpian físicamente: son de este archivo) y con el doble en su estado
// por defecto.
beforeEach(async () => {
  altas = [];
  bajas = [];
  fallaAlCrear = null;
  fallaAlBorrar = null;
  estadoEnMeta = { status: "APPROVED", rejectedReason: null };
  wabaConfigurado = "waba-de-prueba";
  if (orgA && orgB) {
    await prisma.whatsappTemplate.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  }
});

before(async () => {
  process.env.LOG_LEVEL = "fatal";
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
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await prisma.whatsappTemplate.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [adminA, userA, adminB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Permisos y lectura
// ---------------------------------------------------------------------------

test("sin plantilla, GET devuelve null (200): 'no tiene' es un estado normal de la pantalla", async () => {
  const res = await call("GET", "/api/whatsapp-templates", adminA.accessToken);
  assert.equal(res.status, 200);
  assert.equal(await res.json(), null);
});

test("un USER recibe 403 en la lectura y en el alta, y nada llega a Meta", async () => {
  const get = await call("GET", "/api/whatsapp-templates", userA.accessToken);
  assert.equal(get.status, 403);

  const post = await call("POST", "/api/whatsapp-templates", userA.accessToken, cuerpo());
  assert.equal(post.status, 403);
  assert.equal(altas.length, 0);
  assert.equal((await activasDe(orgA)).length, 0);
});

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

test("el alta manda a Meta el texto traducido a {{1}}/{{2}}, UTILITY implícita, con ejemplos; la fila queda PENDING con el id de Meta", async () => {
  const name = nombreAlAzar("ok");
  const creada = await crearPorHttp(adminA.accessToken, { name });

  assert.equal(creada.status, "PENDING");
  assert.equal(creada.name, name);
  assert.equal(altas.length, 1);
  assert.deepEqual(altas[0], {
    wabaId: "waba-de-prueba",
    accessToken: "token-de-prueba",
    name,
    language: "es_AR",
    bodyText: "Hola {{1}}, gracias por tu compra. Tu opinión acá: {{2}} ¡Gracias!",
    bodyExamples: ["Ana", "https://g.page/r/ejemplo/review"],
  });

  const [fila] = await activasDe(orgA);
  assert.equal(fila.id, creada.id);
  // Se guarda lo que escribió el negocio, no la traducción.
  assert.equal(fila.bodyText, TEXTO);
  assert.equal(fila.status, "PENDING");
  assert.ok(fila.metaTemplateId, "guardó el id que dio Meta");

  const get = await call("GET", "/api/whatsapp-templates", adminA.accessToken);
  const leida = (await get.json()) as Record<string, unknown>;
  assert.equal(leida.id, creada.id);
  assert.equal(leida.bodyText, TEXTO);
  // Lo interno de la integración no sale por la API.
  assert.equal("metaTemplateId" in leida, false);
  assert.equal("organizationId" in leida, false);
});

test("un texto inválido es 400 con el motivo, ANTES de tocar Meta y sin reservar nada", async () => {
  const res = await call(
    "POST",
    "/api/whatsapp-templates",
    adminA.accessToken,
    cuerpo({ bodyText: "Tu opinión: {link} — gracias {nombre}!" }),
  );

  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /\{nombre\} tiene que aparecer antes que \{link\}/);
  assert.equal(altas.length, 0);
  assert.equal((await activasDe(orgA)).length, 0);
});

test("un nombre con mayúsculas o guiones es 400 de forma, sin tocar Meta", async () => {
  const res = await call(
    "POST",
    "/api/whatsapp-templates",
    adminA.accessToken,
    cuerpo({ name: "Seguimiento-Postventa" }),
  );
  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /minúsculas, números y guion bajo/);
  assert.equal(altas.length, 0);
});

test("con una PENDING (o APPROVED) activa, otro alta es 409 sin llamar a Meta", async () => {
  await crearPorHttp(adminA.accessToken);
  altas = [];

  const res = await call("POST", "/api/whatsapp-templates", adminA.accessToken, cuerpo());
  assert.equal(res.status, 409);
  assert.match(await mensajeDeError(res), /borrá la actual primero/);
  assert.equal(altas.length, 0);

  await prisma.whatsappTemplate.updateMany({
    where: { organizationId: orgA, deletedAt: null },
    data: { status: "APPROVED" },
  });
  const otra = await call("POST", "/api/whatsapp-templates", adminA.accessToken, cuerpo());
  assert.equal(otra.status, 409);
  assert.equal(altas.length, 0);
  assert.equal((await activasDe(orgA)).length, 1);
});

test("con una REJECTED activa, el alta la reemplaza: la borra en Meta y localmente, y crea la nueva", async () => {
  const vieja = await crearPorHttp(adminA.accessToken);
  await prisma.whatsappTemplate.updateMany({
    where: { id: vieja.id },
    data: { status: "REJECTED", rejectedReason: "INVALID_FORMAT" },
  });

  const nueva = await crearPorHttp(adminA.accessToken);

  assert.equal(bajas.length, 1);
  assert.equal(bajas[0].name, vieja.name);
  const activas = await activasDe(orgA);
  assert.deepEqual(
    activas.map((p) => p.id),
    [nueva.id],
  );
  const borrada = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: vieja.id } });
  assert.ok(borrada.deletedAt, "la rechazada quedó con soft delete");
});

test("el nombre es único en TODA la tabla: otra organización con el mismo nombre es 409; al borrarla, se libera", async () => {
  const name = nombreAlAzar("compartido");
  const deA = await crearPorHttp(adminA.accessToken, { name });
  altas = [];

  const choque = await call(
    "POST",
    "/api/whatsapp-templates",
    adminB.accessToken,
    cuerpo({ name }),
  );
  assert.equal(choque.status, 409);
  assert.match(await mensajeDeError(choque), /nombre de plantilla ya está en uso/);
  assert.equal(altas.length, 0);

  const borrar = await call("DELETE", `/api/whatsapp-templates/${deA.id}`, adminA.accessToken);
  assert.equal(borrar.status, 204);

  const deB = await crearPorHttp(adminB.accessToken, { name });
  assert.equal(deB.name, name);
});

test("si Meta rechaza el alta (4xx): 400 con el motivo de Meta, y la reserva se descarta", async () => {
  fallaAlCrear = new WhatsappGraphError(
    400,
    JSON.stringify({
      error: { message: "Invalid parameter", error_user_msg: "El idioma no existe" },
    }),
  );

  const res = await call("POST", "/api/whatsapp-templates", adminA.accessToken, cuerpo());

  assert.equal(res.status, 400);
  assert.equal(
    await mensajeDeError(res),
    "Meta rechazó el pedido al crear la plantilla: El idioma no existe",
  );
  assert.equal(
    await prisma.whatsappTemplate.count({ where: { organizationId: orgA } }),
    0,
    "ni activa ni borrada: la reserva se descartó",
  );

  // Y el lugar quedó libre: el reintento pasa.
  fallaAlCrear = null;
  await crearPorHttp(adminA.accessToken);
});

test("si Meta no contesta (5xx): 502 'probá de nuevo', y la reserva se descarta", async () => {
  fallaAlCrear = new WhatsappGraphError(503, "Service Unavailable");

  const res = await call("POST", "/api/whatsapp-templates", adminA.accessToken, cuerpo());

  assert.equal(res.status, 502);
  assert.match(await mensajeDeError(res), /Probá de nuevo/);
  assert.equal(await prisma.whatsappTemplate.count({ where: { organizationId: orgA } }), 0);
});

test("sin WHATSAPP_BUSINESS_ACCOUNT_ID: 503 con un mensaje para el negocio, sin tocar Meta ni la base", async () => {
  wabaConfigurado = "  ";

  const res = await call("POST", "/api/whatsapp-templates", adminA.accessToken, cuerpo());

  assert.equal(res.status, 503);
  assert.match(await mensajeDeError(res), /conexión con WhatsApp no está configurada/);
  assert.equal(altas.length, 0);
  assert.equal((await activasDe(orgA)).length, 0);
});

// ---------------------------------------------------------------------------
// Refresh y borrado
// ---------------------------------------------------------------------------

test("refresh: repregunta a Meta y guarda el estado traducido (APPROVED, o REJECTED con el motivo)", async () => {
  const creada = await crearPorHttp(adminA.accessToken);

  estadoEnMeta = { status: "APPROVED", rejectedReason: "NONE" };
  const aprobada = await call(
    "POST",
    `/api/whatsapp-templates/${creada.id}/refresh`,
    adminA.accessToken,
  );
  assert.equal(aprobada.status, 200);
  const cuerpoAprobada = (await aprobada.json()) as Record<string, unknown>;
  assert.equal(cuerpoAprobada.status, "APPROVED");
  assert.equal(cuerpoAprobada.rejectedReason, null);
  assert.equal("metaTemplateId" in cuerpoAprobada, false);

  estadoEnMeta = { status: "REJECTED", rejectedReason: "INVALID_FORMAT" };
  await call("POST", `/api/whatsapp-templates/${creada.id}/refresh`, adminA.accessToken);
  const fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: creada.id } });
  assert.equal(fila.status, "REJECTED");
  assert.equal(fila.rejectedReason, "INVALID_FORMAT");
});

test("borrar: en Meta por nombre + id, y soft delete local; GET vuelve a null", async () => {
  const creada = await crearPorHttp(adminA.accessToken);
  const fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: creada.id } });

  const res = await call("DELETE", `/api/whatsapp-templates/${creada.id}`, adminA.accessToken);

  assert.equal(res.status, 204);
  assert.deepEqual(bajas, [
    {
      wabaId: "waba-de-prueba",
      accessToken: "token-de-prueba",
      name: creada.name,
      metaTemplateId: fila.metaTemplateId,
    },
  ]);
  const borrada = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: creada.id } });
  assert.ok(borrada.deletedAt);
  const get = await call("GET", "/api/whatsapp-templates", adminA.accessToken);
  assert.equal(await get.json(), null);
});

test("borrar una que Meta ya no tiene (404) la borra igual localmente; otro error de Meta no", async () => {
  const primera = await crearPorHttp(adminA.accessToken);
  fallaAlBorrar = new WhatsappGraphError(404, "not found");
  const ok = await call("DELETE", `/api/whatsapp-templates/${primera.id}`, adminA.accessToken);
  assert.equal(ok.status, 204);
  assert.equal((await activasDe(orgA)).length, 0);

  fallaAlBorrar = null;
  const segunda = await crearPorHttp(adminA.accessToken);
  fallaAlBorrar = new WhatsappGraphError(503, "Service Unavailable");
  const falla = await call("DELETE", `/api/whatsapp-templates/${segunda.id}`, adminA.accessToken);
  assert.equal(falla.status, 502);
  assert.equal((await activasDe(orgA)).length, 1, "no se borró localmente lo que sigue en Meta");
});

// ---------------------------------------------------------------------------
// Aislamiento
// ---------------------------------------------------------------------------

test("la organización B no ve, no refresca y no borra la plantilla de la A", async () => {
  const deA = await crearPorHttp(adminA.accessToken);

  const get = await call("GET", "/api/whatsapp-templates", adminB.accessToken);
  assert.equal(await get.json(), null);

  const refresh = await call(
    "POST",
    `/api/whatsapp-templates/${deA.id}/refresh`,
    adminB.accessToken,
  );
  assert.equal(refresh.status, 404);

  const borrar = await call("DELETE", `/api/whatsapp-templates/${deA.id}`, adminB.accessToken);
  assert.equal(borrar.status, 404);
  assert.equal(bajas.length, 0);

  const fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: deA.id } });
  assert.equal(fila.deletedAt, null);
  assert.equal(fila.status, "PENDING");
});
