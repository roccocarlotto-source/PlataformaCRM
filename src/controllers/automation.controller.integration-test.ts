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
import { automationRouter } from "../routes/automation.routes";
import { registroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";

// ---------------------------------------------------------------------------
// CRUD de /api/automations (docs/automations-architecture.md §8) por HTTP real
// contra una app Express real, montando el router real —con su authenticate,
// su authorize y su rate limiter— contra Postgres y GoTrue reales. Mismo
// patrón que agent.controller.integration-test.ts.
//
// Lo que se prueba acá y no se puede probar sin base ni sin la cadena real:
//
//   1. Solo ADMIN escribe: USER recibe 403 en POST/PATCH/DELETE y nada cambia;
//      el GET lo lee cualquiera de la organización.
//   2. Validación contra los catálogos ANTES de guardar: triggerType
//      desconocido, actionType no registrado y actionConfig que no pasa el
//      schema de la acción son 400 y no crean nada.
//   3. Aislamiento multi-tenant: la organización B no ve, no edita y no borra
//      una regla de la A — 404 en los tres, y la fila queda intacta.
//   4. Soft delete: DELETE marca deletedAt, el GET pasa a 404, el listado lo
//      excluye, y la fila sigue en la base.
//
// EL REGISTRO DE ACCIONES ES EL SINGLETON DE PRODUCCIÓN, poblado con la misma
// función que usa server.ts: el controller no recibe registros por parámetro,
// así que el camino HTTP real valida contra el singleton. Cada archivo de test
// corre en su propio proceso, así que poblarlo acá no toca a ningún otro.
// ---------------------------------------------------------------------------

const PASSWORD = "Automation-test-password-123!";

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

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", automationRouter);
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
      name: `Automations ${etiqueta} ${randomUUID()}`,
      slug: `automations-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `automations-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Automations Test ${label}`,
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

function cuerpoValido(extra: Record<string, unknown> = {}) {
  return {
    name: "Seguimiento post-venta",
    triggerType: "opportunity.won",
    actionType: "activity.create_follow_up",
    actionConfig: { subject: "Llamar para agradecer la compra", daysUntilDue: 3 },
    ...extra,
  };
}

async function crearReglaPorHttp(
  token: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await call("POST", "/api/automations", token, cuerpoValido(extra));
  // El body se lee UNA vez: un `${await res.text()}` dentro del mensaje del
  // assert se evalúa aunque el assert pase, y deja el body inutilizable.
  const crudo = await res.text();
  assert.equal(res.status, 201, `no se pudo crear la regla: ${crudo}`);
  return JSON.parse(crudo) as Record<string, unknown>;
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

async function filaDe(id: string) {
  return prisma.automation.findUniqueOrThrow({ where: { id } });
}

before(async () => {
  // Mismo bootstrap que server.ts, sobre los singletons. Si otro test del
  // mismo proceso ya lo hizo, registrar lanzaría; hoy este archivo es el único.
  if (registroDeAcciones.tiposRegistrados().length === 0) {
    registrarAutomatizaciones();
  }

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
    await prisma.automationExecution.deleteMany({ where: { organizationId: org } });
    await prisma.automation.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [adminA, userA, adminB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Camino feliz y forma de los datos
// ---------------------------------------------------------------------------

test("POST /api/automations — ADMIN crea la regla; el actionConfig se guarda ya normalizado por el schema de la acción", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken, {
    actionConfig: { subject: "  Llamar para agradecer la compra  ", daysUntilDue: 3 },
  });

  assert.equal(regla.organizationId, orgA);
  assert.equal(regla.name, "Seguimiento post-venta");
  assert.equal(regla.triggerType, "opportunity.won");
  assert.equal(regla.actionType, "activity.create_follow_up");
  // trim aplicado: se persiste lo que el schema devolvió, no el crudo.
  assert.deepEqual(regla.actionConfig, {
    subject: "Llamar para agradecer la compra",
    daysUntilDue: 3,
  });
  assert.equal(regla.isActive, true);
  assert.equal(regla.deletedAt, null);
  assert.match(String(regla.id), /^[0-9a-f-]{36}$/, "id UUID, como el resto del schema");
});

test("POST /api/automations — notes opcional: con notas se guardan trimeadas; sin notas la clave NO queda en el actionConfig", async () => {
  const conNotas = await crearReglaPorHttp(adminA.accessToken, {
    actionConfig: {
      subject: "Llamar para agradecer la compra",
      daysUntilDue: 3,
      notes: "  Preguntar por la patente definitiva  ",
    },
  });
  assert.deepEqual(conNotas.actionConfig, {
    subject: "Llamar para agradecer la compra",
    daysUntilDue: 3,
    notes: "Preguntar por la patente definitiva",
  });

  // "Sin notas" se guarda como la AUSENCIA de la clave, no como "": es lo que
  // hace que la Activity quede con body null. Ítem 68.
  const sinNotas = await crearReglaPorHttp(adminA.accessToken, {
    actionConfig: { subject: "Llamar", daysUntilDue: 1 },
  });
  assert.deepEqual(sinNotas.actionConfig, { subject: "Llamar", daysUntilDue: 1 });
});

test("POST /api/automations — notes vacío, solo espacios o de más de 5.000 caracteres es 400 y no crea la regla", async () => {
  const antes = await contarReglasDe(orgA);

  for (const notes of ["", "   "]) {
    const res = await call(
      "POST",
      "/api/automations",
      adminA.accessToken,
      cuerpoValido({ actionConfig: { subject: "Llamar", daysUntilDue: 3, notes } }),
    );
    assert.equal(res.status, 400, `notes=${JSON.stringify(notes)} debía ser 400`);
    assert.match(await mensajeDeError(res), /notes no puede ser un string vacío/);
  }

  const demasiadoLargo = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({
      actionConfig: { subject: "Llamar", daysUntilDue: 3, notes: "x".repeat(5001) },
    }),
  );
  assert.equal(demasiadoLargo.status, 400);
  assert.match(await mensajeDeError(demasiadoLargo), /notes no puede superar los 5000 caracteres/);

  assert.equal(await contarReglasDe(orgA), antes);
});

test("POST /api/automations — isActive: false se respeta al crear", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken, { isActive: false });
  assert.equal(regla.isActive, false);
});

test("GET /api/automations y GET /:id — un USER de la organización lee; el listado pagina y filtra por triggerType e isActive", async () => {
  const creada = await crearReglaPorHttp(adminA.accessToken, { name: "Visible para USER" });

  const uno = await call("GET", `/api/automations/${String(creada.id)}`, userA.accessToken);
  assert.equal(uno.status, 200);
  assert.equal(((await uno.json()) as { id: string }).id, creada.id);

  const lista = await call("GET", "/api/automations?pageSize=100", userA.accessToken);
  assert.equal(lista.status, 200);
  const cuerpo = (await lista.json()) as {
    data: { id: string; isActive: boolean }[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
  assert.ok(cuerpo.data.some((r) => r.id === creada.id));
  assert.equal(cuerpo.pagination.page, 1);
  assert.equal(cuerpo.pagination.pageSize, 100);
  assert.equal(cuerpo.pagination.total, cuerpo.data.length);

  const soloActivas = await call(
    "GET",
    "/api/automations?isActive=true&triggerType=opportunity.won&pageSize=100",
    userA.accessToken,
  );
  const activas = (await soloActivas.json()) as { data: { isActive: boolean }[] };
  assert.ok(activas.data.length > 0);
  assert.ok(activas.data.every((r) => r.isActive === true));

  const ninguna = await call("GET", "/api/automations?triggerType=otro.trigger", userA.accessToken);
  assert.deepEqual(((await ninguna.json()) as { data: unknown[] }).data, []);
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

test("un USER no escribe: 403 en POST, PATCH y DELETE, y nada cambia", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken, { name: "Intocable por USER" });

  const post = await call("POST", "/api/automations", userA.accessToken, cuerpoValido());
  assert.equal(post.status, 403);

  const patch = await call("PATCH", `/api/automations/${String(regla.id)}`, userA.accessToken, {
    name: "Cambiada por USER",
  });
  assert.equal(patch.status, 403);

  const del = await call("DELETE", `/api/automations/${String(regla.id)}`, userA.accessToken);
  assert.equal(del.status, 403);

  const fila = await filaDe(String(regla.id));
  assert.equal(fila.name, "Intocable por USER");
  assert.equal(fila.deletedAt, null);
});

test("sin token, las cinco rutas dan 401", async () => {
  const id = randomUUID();
  for (const [method, path] of [
    ["GET", "/api/automations"],
    ["GET", `/api/automations/${id}`],
    ["POST", "/api/automations"],
    ["PATCH", `/api/automations/${id}`],
    ["DELETE", `/api/automations/${id}`],
  ] as const) {
    const res = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------
// Validación contra los catálogos — 400 ANTES de guardar
// ---------------------------------------------------------------------------

async function contarReglasDe(organizationId: string) {
  return prisma.automation.count({ where: { organizationId } });
}

test("triggerType que no está en el catálogo es 400 y no crea nada", async () => {
  const antes = await contarReglasDe(orgA);
  const res = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ triggerType: "booking.reminder" }),
  );
  assert.equal(res.status, 400);
  assert.match(
    await mensajeDeError(res),
    /triggerType "booking\.reminder" no existe.*opportunity\.won/,
  );
  assert.equal(await contarReglasDe(orgA), antes);
});

test("actionType que no está registrado es 400 y no crea nada", async () => {
  const antes = await contarReglasDe(orgA);
  const res = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionType: "whatsapp.send_reminder" }),
  );
  assert.equal(res.status, 400);
  assert.match(
    await mensajeDeError(res),
    /actionType "whatsapp\.send_reminder" no existe.*activity\.create_follow_up/,
  );
  assert.equal(await contarReglasDe(orgA), antes);
});

test("actionConfig que no pasa el schema de la acción es 400 con el motivo — sin daysUntilDue no hay default oculto", async () => {
  const antes = await contarReglasDe(orgA);

  const sinDias = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionConfig: { subject: "Llamar" } }),
  );
  assert.equal(sinDias.status, 400);
  assert.match(
    await mensajeDeError(sinDias),
    /actionConfig inválido para "activity\.create_follow_up".*daysUntilDue es requerido/,
  );

  const fueraDeRango = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionConfig: { subject: "Llamar", daysUntilDue: 400 } }),
  );
  assert.equal(fueraDeRango.status, 400);
  assert.match(await mensajeDeError(fueraDeRango), /365/);

  const sinSubject = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionConfig: { daysUntilDue: 3 } }),
  );
  assert.equal(sinSubject.status, 400);
  assert.match(await mensajeDeError(sinSubject), /subject es requerido/);

  assert.equal(await contarReglasDe(orgA), antes);
});

test("la forma del cuerpo también se valida: actionConfig que no es objeto, name vacío, cuerpo vacío en PATCH", async () => {
  const arreglo = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionConfig: [1, 2] }),
  );
  assert.equal(arreglo.status, 400);
  assert.match(await mensajeDeError(arreglo), /actionConfig debe ser un objeto JSON/);

  const sinNombre = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ name: "   " }),
  );
  assert.equal(sinNombre.status, 400);
  assert.match(await mensajeDeError(sinNombre), /name es requerido/);

  const regla = await crearReglaPorHttp(adminA.accessToken);
  const vacio = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {});
  assert.equal(vacio.status, 400);
  assert.match(await mensajeDeError(vacio), /al menos un campo/);

  const idInvalido = await call("GET", "/api/automations/no-es-uuid", adminA.accessToken);
  assert.equal(idInvalido.status, 400);
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

test("PATCH parcial: cambiar name e isActive no exige reenviar el actionConfig", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken);

  const res = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    name: "Renombrada",
    isActive: false,
  });
  assert.equal(res.status, 200);
  const actualizada = (await res.json()) as Record<string, unknown>;
  assert.equal(actualizada.name, "Renombrada");
  assert.equal(actualizada.isActive, false);
  assert.deepEqual(actualizada.actionConfig, regla.actionConfig, "el config no se tocó");
});

test("PATCH de actionConfig se valida contra la acción vigente: inválido es 400 y la fila no cambia", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken);

  const malo = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    actionConfig: { subject: "Llamar", daysUntilDue: -1 },
  });
  assert.equal(malo.status, 400);
  assert.match(await mensajeDeError(malo), /daysUntilDue no puede ser negativo/);
  assert.deepEqual((await filaDe(String(regla.id))).actionConfig, regla.actionConfig);

  const bueno = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    actionConfig: { subject: "Visitar", daysUntilDue: 7 },
  });
  assert.equal(bueno.status, 200);
  assert.deepEqual(((await bueno.json()) as Record<string, unknown>).actionConfig, {
    subject: "Visitar",
    daysUntilDue: 7,
  });
});

test("PATCH de triggerType o actionType desconocidos es 400", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken);

  const trigger = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    triggerType: "opportunity.lost",
  });
  assert.equal(trigger.status, 400);
  assert.match(await mensajeDeError(trigger), /triggerType "opportunity\.lost" no existe/);

  const accion = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    actionType: "resea.send_qr",
  });
  assert.equal(accion.status, 400);
  assert.match(await mensajeDeError(accion), /actionType "resea\.send_qr" no existe/);
});

// ---------------------------------------------------------------------------
// opportunity.stale y agent.draft_follow_up (ítem 76): triggerConfig, la
// compatibilidad acción/trigger y la regla única por organización.
//
// Cada test deja su regla de stale BORRADA al terminar: la regla única es por
// organización, y una que quedara activa haría fallar al siguiente con 409.
// ---------------------------------------------------------------------------

function cuerpoEstancada(extra: Record<string, unknown> = {}) {
  return {
    name: "Seguimiento de estancadas",
    triggerType: "opportunity.stale",
    triggerConfig: { daysWithoutActivity: 7 },
    actionType: "agent.draft_follow_up",
    actionConfig: {},
    ...extra,
  };
}

async function borrar(id: unknown) {
  await prisma.automation.update({ where: { id: String(id) }, data: { deletedAt: new Date() } });
}

test("POST opportunity.stale + agent.draft_follow_up: se crea con su triggerConfig; una regla de won queda con triggerConfig {}", async () => {
  const res = await call("POST", "/api/automations", adminA.accessToken, cuerpoEstancada());
  const crudo = await res.text();
  assert.equal(res.status, 201, crudo);
  const regla = JSON.parse(crudo) as Record<string, unknown>;
  assert.equal(regla.triggerType, "opportunity.stale");
  assert.equal(regla.actionType, "agent.draft_follow_up");
  assert.deepEqual(regla.triggerConfig, { daysWithoutActivity: 7 });
  assert.deepEqual(regla.actionConfig, {});

  // La de siempre, sin mandar triggerConfig: default "{}".
  const won = await crearReglaPorHttp(adminA.accessToken);
  assert.deepEqual(won.triggerConfig, {});

  await borrar(regla.id);
});

test("POST opportunity.stale SIN daysWithoutActivity, o con uno inválido, es 400 y no crea nada", async () => {
  const antes = await prisma.automation.count({ where: { organizationId: orgA } });

  const sinConfig = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({ triggerConfig: undefined }),
  );
  assert.equal(sinConfig.status, 400);
  assert.match(await mensajeDeError(sinConfig), /daysWithoutActivity es requerido/);

  const negativo = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({ triggerConfig: { daysWithoutActivity: -2 } }),
  );
  assert.equal(negativo.status, 400);
  assert.match(await mensajeDeError(negativo), /daysWithoutActivity no puede ser negativo/);

  const noObjeto = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({ triggerConfig: [7] }),
  );
  assert.equal(noObjeto.status, 400);

  assert.equal(await prisma.automation.count({ where: { organizationId: orgA } }), antes);
});

test("acción y trigger incompatibles son 400: create_follow_up con stale (tarea diaria infinita) y draft_follow_up con won", async () => {
  const seguimientoConStale = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({
      actionType: "activity.create_follow_up",
      actionConfig: { subject: "Llamar", daysUntilDue: 1 },
    }),
  );
  assert.equal(seguimientoConStale.status, 400);
  assert.match(
    await mensajeDeError(seguimientoConStale),
    /"activity.create_follow_up" no se puede usar con el trigger "opportunity.stale"/,
  );

  const borradorConWon = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoValido({ actionType: "agent.draft_follow_up", actionConfig: {} }),
  );
  assert.equal(borradorConWon.status, 400);
  assert.match(
    await mensajeDeError(borradorConWon),
    /"agent.draft_follow_up" no se puede usar con el trigger "opportunity.won"/,
  );

  // Y por PATCH: cambiar solo el trigger de una regla de won a stale choca con
  // su acción (además de pedir daysWithoutActivity).
  const regla = await crearReglaPorHttp(adminA.accessToken);
  const patch = await call("PATCH", `/api/automations/${String(regla.id)}`, adminA.accessToken, {
    triggerType: "opportunity.stale",
    triggerConfig: { daysWithoutActivity: 3 },
  });
  assert.equal(patch.status, 400);
  assert.equal((await filaDe(String(regla.id))).triggerType, "opportunity.won");
});

test("una sola regla ACTIVA de opportunity.stale por organización: la segunda es 409; inactiva sí se puede; activarla es 409", async () => {
  const primera = await call("POST", "/api/automations", adminA.accessToken, cuerpoEstancada());
  assert.equal(primera.status, 201);
  const reglaUno = (await primera.json()) as Record<string, unknown>;

  const segunda = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({ triggerConfig: { daysWithoutActivity: 15 } }),
  );
  assert.equal(segunda.status, 409);
  assert.match(await mensajeDeError(segunda), /solo puede haber una/);

  // Inactiva no compite: se puede crear.
  const inactiva = await call(
    "POST",
    "/api/automations",
    adminA.accessToken,
    cuerpoEstancada({ isActive: false }),
  );
  assert.equal(inactiva.status, 201);
  const reglaDos = (await inactiva.json()) as Record<string, unknown>;

  // Pero activarla mientras la otra sigue activa, no.
  const activar = await call(
    "PATCH",
    `/api/automations/${String(reglaDos.id)}`,
    adminA.accessToken,
    {
      isActive: true,
    },
  );
  assert.equal(activar.status, 409);
  assert.equal((await filaDe(String(reglaDos.id))).isActive, false);

  // Editar la activa (su propio id no cuenta como "otra") sí se puede.
  const editar = await call(
    "PATCH",
    `/api/automations/${String(reglaUno.id)}`,
    adminA.accessToken,
    {
      triggerConfig: { daysWithoutActivity: 10 },
    },
  );
  assert.equal(editar.status, 200);
  assert.deepEqual(((await editar.json()) as Record<string, unknown>).triggerConfig, {
    daysWithoutActivity: 10,
  });

  // La organización B no cuenta: su primera regla de stale se crea sin 409.
  const deB = await call("POST", "/api/automations", adminB.accessToken, cuerpoEstancada());
  assert.equal(deB.status, 201);
  const reglaB = (await deB.json()) as Record<string, unknown>;

  // Borrada la primera, la inactiva ya se puede activar.
  await borrar(reglaUno.id);
  const ahoraSi = await call(
    "PATCH",
    `/api/automations/${String(reglaDos.id)}`,
    adminA.accessToken,
    {
      isActive: true,
    },
  );
  assert.equal(ahoraSi.status, 200);

  await borrar(reglaDos.id);
  await borrar(reglaB.id);
});

// ---------------------------------------------------------------------------
// Aislamiento multi-tenant
// ---------------------------------------------------------------------------

test("la organización B no ve, no edita ni borra una regla de la A: 404 en los tres y la fila intacta", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken, { name: "Solo de A" });
  const id = String(regla.id);

  const get = await call("GET", `/api/automations/${id}`, adminB.accessToken);
  assert.equal(get.status, 404);

  const patch = await call("PATCH", `/api/automations/${id}`, adminB.accessToken, {
    name: "Pisada por B",
  });
  assert.equal(patch.status, 404);

  const del = await call("DELETE", `/api/automations/${id}`, adminB.accessToken);
  assert.equal(del.status, 404);

  const lista = await call("GET", "/api/automations?pageSize=100", adminB.accessToken);
  const cuerpo = (await lista.json()) as { data: { id: string }[] };
  assert.ok(!cuerpo.data.some((r) => r.id === id), "el listado de B no incluye reglas de A");

  const fila = await filaDe(id);
  assert.equal(fila.name, "Solo de A");
  assert.equal(fila.deletedAt, null);
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

test("DELETE marca deletedAt: el GET pasa a 404, el listado la excluye, un segundo DELETE es 404, y la fila sigue en la base", async () => {
  const regla = await crearReglaPorHttp(adminA.accessToken, { name: "Para borrar" });
  const id = String(regla.id);

  const del = await call("DELETE", `/api/automations/${id}`, adminA.accessToken);
  assert.equal(del.status, 204);

  const get = await call("GET", `/api/automations/${id}`, adminA.accessToken);
  assert.equal(get.status, 404);

  const lista = await call("GET", "/api/automations?pageSize=100", adminA.accessToken);
  const cuerpo = (await lista.json()) as { data: { id: string }[] };
  assert.ok(!cuerpo.data.some((r) => r.id === id));

  const otraVez = await call("DELETE", `/api/automations/${id}`, adminA.accessToken);
  assert.equal(otraVez.status, 404);

  const patch = await call("PATCH", `/api/automations/${id}`, adminA.accessToken, {
    name: "Resucitada",
  });
  assert.equal(patch.status, 404);

  const fila = await filaDe(id);
  assert.ok(fila.deletedAt, "soft delete: la fila sigue, con deletedAt");
  assert.equal(fila.name, "Para borrar");
});
