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
import { activityRouter } from "../routes/activity.routes";

// ---------------------------------------------------------------------------
// §25 (docs/frontend-cambios-pendientes.md) — GET /api/activities y GET
// /api/activities/:id por HTTP real contra una app Express real, montando el
// router real con su authenticate, contra Postgres y GoTrue reales. Mismo
// patrón que organization.controller.integration-test.ts.
//
// Lo que este archivo prueba y el test del service no puede: que el
// controller arma el actor desde req.auth (el JWT) y NO desde la query. La
// regla en sí (USER solo ve lo asignado a sí mismo, ADMIN todo) ya está
// cubierta en activity.service.test.ts (pura) y
// activity.service.integration-test.ts (filas reales).
//
//   1. USER con ?assigneeId=<otra persona> recibe solo lo suyo.
//   2. USER sin filtro recibe solo lo suyo.
//   3. USER pidiendo por id una ajena: 404 con el mismo mensaje que un id
//      inexistente; la propia: 200.
//   4. ADMIN sin cambios: filtrar por el assigneeId de cualquier persona
//      devuelve lo pedido, y cualquier id se lee.
// ---------------------------------------------------------------------------

const PASSWORD = "Act-test-password-123!";

interface FixtureUser {
  id: string;
  accessToken: string;
}

let orgId: string;
let admin: FixtureUser;
let user: FixtureUser;
let other: FixtureUser;
let companyId: string;
let propiaId: string;
let ajenaId: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", activityRouter);
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

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `act-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Act Test ${label}`,
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

  return { id: data.user.id, accessToken: signInData.session.access_token };
}

function get(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
}

function patch(path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

interface ListBody {
  data: { id: string; assigneeId: string | null; completedAt: string | null }[];
  pagination: { total: number };
}

interface ActivityBody {
  id: string;
  completedAt: string | null;
  confirmedAt: string | null;
  confirmedById: string | null;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Activity read test ${randomUUID()}`,
      slug: `activity-read-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  admin = await createFixtureUser("admin", orgId, "ADMIN");
  user = await createFixtureUser("user", orgId, "USER");
  other = await createFixtureUser("other", orgId, "USER");

  const company = await prisma.company.create({
    data: { organizationId: orgId, name: "Act Company" },
  });
  companyId = company.id;
  const propia = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: user.id,
      companyId: company.id,
      type: "TASK",
      subject: "§25 propia",
    },
  });
  const ajena = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: other.id,
      companyId: company.id,
      type: "TASK",
      subject: "§25 ajena",
    },
  });
  propiaId = propia.id;
  ajenaId = ajena.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.company.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  for (const u of [admin, user, other]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.id);
  }
});

test("GET /api/activities — USER mandando ?assigneeId=<otra persona> recibe solo lo suyo: el filtro se ignora", async () => {
  const res = await get(`/api/activities?assigneeId=${other.id}`, user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;

  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, propiaId);
  assert.equal(body.data[0].assigneeId, user.id);
  assert.equal(body.pagination.total, 1);
});

test("GET /api/activities — USER sin filtro recibe solo lo suyo, no el listado completo de la organización", async () => {
  const res = await get("/api/activities", user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;

  assert.deepEqual(
    body.data.map((a) => a.id),
    [propiaId],
  );
  assert.equal(body.pagination.total, 1);
});

test("GET /api/activities/:id — USER: la propia es 200; una ajena es 404 con el mismo mensaje que un id inexistente", async () => {
  const propia = await get(`/api/activities/${propiaId}`, user.accessToken);
  assert.equal(propia.status, 200);
  assert.equal(((await propia.json()) as { id: string }).id, propiaId);

  const ajena = await get(`/api/activities/${ajenaId}`, user.accessToken);
  assert.equal(ajena.status, 404);
  const ajenaBody = (await ajena.json()) as { error: { message: string } };

  const inexistente = await get(`/api/activities/${randomUUID()}`, user.accessToken);
  assert.equal(inexistente.status, 404);
  const inexistenteBody = (await inexistente.json()) as { error: { message: string } };

  assert.equal(ajenaBody.error.message, "Actividad no encontrada");
  assert.equal(ajenaBody.error.message, inexistenteBody.error.message);
});

test("GET /api/activities — ADMIN sin cambios: filtrar por el assigneeId de cualquier persona devuelve lo pedido, y lee cualquier id", async () => {
  const deOtro = await get(`/api/activities?assigneeId=${other.id}`, admin.accessToken);
  assert.equal(deOtro.status, 200);
  const deOtroBody = (await deOtro.json()) as ListBody;
  assert.deepEqual(
    deOtroBody.data.map((a) => a.id),
    [ajenaId],
  );

  const todo = await get("/api/activities", admin.accessToken);
  assert.equal(todo.status, 200);
  const todoBody = (await todo.json()) as ListBody;
  assert.equal(todoBody.pagination.total, 2);

  const ajena = await get(`/api/activities/${ajenaId}`, admin.accessToken);
  assert.equal(ajena.status, 200);
});

// ---------------------------------------------------------------------------
// §29 — el flujo completo de confirmación por HTTP, con la app y los JWT
// reales: USER completa su tarea desde "Mis tareas" → queda pendiente de
// confirmar (y la sigue viendo, ahora con confirmed=false en vez de
// completed=false) → USER no puede destildarla ni confirmarla → ADMIN la
// confirma → USER ya no la ve en "Mis tareas". Lo que este archivo agrega
// sobre el test del service: que el body `confirmed` pasa por el schema del
// controller, que confirmedById sale de req.auth y no del body, y que un
// confirmedAt/confirmedById mandados por el cliente se ignoran.
// ---------------------------------------------------------------------------

test("§29 flujo completo: USER completa → pendiente de confirmar → ADMIN confirma → desaparece de 'Mis tareas'", async () => {
  const company = await prisma.company.findFirstOrThrow({ where: { organizationId: orgId } });
  const tarea = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: user.id,
      companyId: company.id,
      type: "TASK",
      subject: "§29 flujo",
    },
  });
  const misTareas = `/api/activities?assigneeId=${user.id}&confirmed=false&sortBy=dueDate&sortOrder=asc`;

  // 1. Antes de tildar: está en "Mis tareas", pendiente.
  let lista = (await (await get(misTareas, user.accessToken)).json()) as ListBody;
  assert.ok(lista.data.some((a) => a.id === tarea.id && a.completedAt === null));

  // 2. USER tilda (solo completedAt). Queda completada y SIN confirmar,
  //    aunque el body intente colar confirmedAt/confirmedById: el schema los
  //    rechaza como claves desconocidas (Zod los descarta) y el service nunca
  //    los toma del body.
  const completedAt = new Date().toISOString();
  const tildar = await patch(`/api/activities/${tarea.id}`, user.accessToken, { completedAt });
  assert.equal(tildar.status, 200);
  const tildada = (await tildar.json()) as ActivityBody;
  assert.equal(tildada.completedAt, completedAt);
  assert.equal(tildada.confirmedAt, null);
  assert.equal(tildada.confirmedById, null);

  const colada = await patch(`/api/activities/${tarea.id}`, user.accessToken, {
    completedAt,
    confirmedAt: completedAt,
    confirmedById: user.id,
  });
  // Ya está completada: el self-service no permite volver a mandar
  // completedAt (403), y aunque lo permitiera, confirmedAt/confirmedById no
  // son parte del contrato.
  assert.equal(colada.status, 403);

  // 3. Sigue en "Mis tareas" (confirmed=false), ahora completada.
  lista = (await (await get(misTareas, user.accessToken)).json()) as ListBody;
  assert.ok(lista.data.some((a) => a.id === tarea.id && a.completedAt === completedAt));

  // 4. USER no puede destildarla ni confirmarla/rechazarla.
  assert.equal(
    (await patch(`/api/activities/${tarea.id}`, user.accessToken, { completedAt: null })).status,
    403,
  );
  assert.equal(
    (await patch(`/api/activities/${tarea.id}`, user.accessToken, { confirmed: true })).status,
    403,
  );
  assert.equal(
    (await patch(`/api/activities/${tarea.id}`, user.accessToken, { confirmed: false })).status,
    403,
  );

  // 5. La cola del ADMIN la lista.
  const cola = (await (
    await get("/api/activities?completed=true&confirmed=false", admin.accessToken)
  ).json()) as ListBody;
  assert.ok(cola.data.some((a) => a.id === tarea.id));

  // 6. ADMIN confirma: confirmedById es el ADMIN del JWT, no algo del body.
  const confirmar = await patch(`/api/activities/${tarea.id}`, admin.accessToken, {
    confirmed: true,
  });
  assert.equal(confirmar.status, 200);
  const confirmada = (await confirmar.json()) as ActivityBody;
  assert.equal(confirmada.completedAt, completedAt);
  assert.ok(confirmada.confirmedAt, "confirmedAt seteado por el server");
  assert.equal(confirmada.confirmedById, admin.id);

  // 7. Confirmar dos veces: 400 con el mensaje de la guarda.
  const otraVez = await patch(`/api/activities/${tarea.id}`, admin.accessToken, {
    confirmed: true,
  });
  assert.equal(otraVez.status, 400);
  const otraVezBody = (await otraVez.json()) as { error: { message: string } };
  assert.equal(otraVezBody.error.message, "La actividad ya está confirmada");

  // 8. Recién ahora desaparece de "Mis tareas" del USER, y sale de la cola.
  lista = (await (await get(misTareas, user.accessToken)).json()) as ListBody;
  assert.ok(!lista.data.some((a) => a.id === tarea.id));
  const colaDespues = (await (
    await get("/api/activities?completed=true&confirmed=false", admin.accessToken)
  ).json()) as ListBody;
  assert.ok(!colaDespues.data.some((a) => a.id === tarea.id));
});

test("§29 rechazar por HTTP: la tarea vuelve a 'Mis tareas' del USER como pendiente y puede tildarse otra vez", async () => {
  const company = await prisma.company.findFirstOrThrow({ where: { organizationId: orgId } });
  const tarea = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: user.id,
      companyId: company.id,
      type: "TASK",
      subject: "§29 rechazo",
      completedAt: new Date("2026-09-10T12:00:00.000Z"),
    },
  });

  const rechazar = await patch(`/api/activities/${tarea.id}`, admin.accessToken, {
    confirmed: false,
  });
  assert.equal(rechazar.status, 200);
  const rechazada = (await rechazar.json()) as ActivityBody;
  assert.equal(rechazada.completedAt, null);
  assert.equal(rechazada.confirmedAt, null);
  assert.equal(rechazada.confirmedById, null);

  // Rechazar una pendiente: 400.
  const nada = await patch(`/api/activities/${tarea.id}`, admin.accessToken, { confirmed: false });
  assert.equal(nada.status, 400);

  // El USER la ve pendiente y la vuelve a tildar.
  const lista = (await (
    await get(`/api/activities?assigneeId=${user.id}&confirmed=false`, user.accessToken)
  ).json()) as ListBody;
  assert.ok(lista.data.some((a) => a.id === tarea.id && a.completedAt === null));
  const tildar = await patch(`/api/activities/${tarea.id}`, user.accessToken, {
    completedAt: new Date().toISOString(),
  });
  assert.equal(tildar.status, 200);
});

// ---------------------------------------------------------------------------
// B-18 (docs-privados/auditoria-2026-09-30-corta.md, local, no está en
// GitHub) — el vendedor crea tareas. POST ya no es ADMIN-only: un USER crea
// actividades asignadas a sí mismo (sin assignee → él; otro → 403). PATCH:
// edita las que creó y tiene asignadas mientras no estén completadas; las
// que le asignó un ADMIN solo las completa. DELETE sigue siendo ADMIN.
// La regla pura está en activity.service.test.ts; esto prueba que el
// controller arma el actor desde el JWT y que un 403 no escribe nada.
// ---------------------------------------------------------------------------

const MENSAJE_SOLO_A_VOS = "Como vendedor solo podés crear o editar actividades asignadas a vos";

interface CreatedBody {
  id: string;
  authorId: string;
  assigneeId: string | null;
  subject: string;
}

test("B-18 POST — ADMIN crea una actividad asignada a otro usuario: 201", async () => {
  const res = await post("/api/activities", admin.accessToken, {
    type: "TASK",
    subject: "B-18 admin a otro",
    companyId,
    assigneeId: other.id,
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as CreatedBody;
  assert.equal(body.authorId, admin.id);
  assert.equal(body.assigneeId, other.id);
});

test("B-18 POST — USER sin assignee: 201 y queda asignada a sí mismo", async () => {
  const res = await post("/api/activities", user.accessToken, {
    type: "TASK",
    subject: "B-18 user sin assignee",
    companyId,
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as CreatedBody;
  assert.equal(body.authorId, user.id);
  assert.equal(body.assigneeId, user.id);
});

test("B-18 POST — USER con su propio assignee: 201", async () => {
  const res = await post("/api/activities", user.accessToken, {
    type: "CALL",
    subject: "B-18 user a sí mismo",
    companyId,
    assigneeId: user.id,
  });
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as CreatedBody).assigneeId, user.id);
});

test("B-18 POST — USER asignando a otro usuario: 403 con mensaje claro, y no se crea nada", async () => {
  const antes = await prisma.activity.count({ where: { organizationId: orgId } });
  const res = await post("/api/activities", user.accessToken, {
    type: "TASK",
    subject: "B-18 user a otro",
    companyId,
    assigneeId: other.id,
  });
  assert.equal(res.status, 403);
  assert.equal(
    ((await res.json()) as { error: { message: string } }).error.message,
    MENSAJE_SOLO_A_VOS,
  );
  assert.equal(await prisma.activity.count({ where: { organizationId: orgId } }), antes);
});

test("B-18 PATCH — USER edita la que creó y tiene asignada; no puede reasignarla ni dejarla sin asignar", async () => {
  const creada = (await (
    await post("/api/activities", user.accessToken, {
      type: "TASK",
      subject: "B-18 editable",
      companyId,
    })
  ).json()) as CreatedBody;

  const editar = await patch(`/api/activities/${creada.id}`, user.accessToken, {
    subject: "B-18 editada",
    dueDate: "2026-10-15T12:00:00.000Z",
  });
  assert.equal(editar.status, 200);
  assert.equal(((await editar.json()) as CreatedBody).subject, "B-18 editada");

  for (const assigneeId of [other.id, null]) {
    const reasignar = await patch(`/api/activities/${creada.id}`, user.accessToken, {
      assigneeId,
    });
    assert.equal(reasignar.status, 403);
    assert.equal(
      ((await reasignar.json()) as { error: { message: string } }).error.message,
      MENSAJE_SOLO_A_VOS,
    );
  }
  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: creada.id } });
  assert.equal(fila.assigneeId, user.id);

  // Completada, queda congelada para el USER (§29).
  const tildar = await patch(`/api/activities/${creada.id}`, user.accessToken, {
    completedAt: new Date().toISOString(),
  });
  assert.equal(tildar.status, 200);
  const despues = await patch(`/api/activities/${creada.id}`, user.accessToken, {
    subject: "B-18 tarde",
  });
  assert.equal(despues.status, 403);
});

test("B-18 PATCH — USER no edita la que le asignó un ADMIN (solo puede completarla)", async () => {
  const res = await patch(`/api/activities/${propiaId}`, user.accessToken, {
    subject: "B-18 pisada",
  });
  assert.equal(res.status, 403);
  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: propiaId } });
  assert.equal(fila.subject, "§25 propia");
});

test("B-18 DELETE — sigue siendo solo ADMIN, aunque el USER la haya creado", async () => {
  const creada = (await (
    await post("/api/activities", user.accessToken, {
      type: "NOTE",
      subject: "B-18 no borrable",
      companyId,
    })
  ).json()) as CreatedBody;
  const res = await del(`/api/activities/${creada.id}`, user.accessToken);
  assert.equal(res.status, 403);
  const fila = await prisma.activity.findUniqueOrThrow({ where: { id: creada.id } });
  assert.equal(fila.deletedAt, null);
});
