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
import { ingestionEventRouter } from "../routes/ingestionEvent.routes";
import { sourceRouter } from "../routes/source.routes";
import { drenarPendientes } from "../workers/ingestionWorker";

// Test de integración del listado y el reproceso de IngestionEvent (G-1, G-2 y
// G-7 de docs/research-frontend-ingesta-2026-08-27.md): HTTP real contra una app
// Express real, montando los routers reales —con su authenticate, su authorize y
// su rate limiter— contra Postgres y GoTrue reales. Sin mocks. Mismo patrón que
// apiKey.controller.integration-test.ts.
//
// LE PREGUNTA A LA BASE, NO AL SERVICE, para todo lo que sea "qué quedó
// guardado": el status después de un reintento se lee de vuelta de
// ingestion_events, nunca del objeto que devolvió el endpoint.
//
// AISLAMIENTO ENTRE TESTS POR `Source`, no por limpieza entre casos: los tests
// de listado leen SIEMPRE de `sourceList`, que nadie muta, y los de reproceso
// crean sus propios eventos sobre `sourceRetry`. Sin esa separación, un
// reintento cambiaría los contadores que un test de filtros está afirmando.

const PASSWORD = "IngestionEvents-test-password-123!";

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
  // Fuente de solo lectura para los tests de listado.
  sourceList: string;
  // Fuente donde los tests de reproceso crean y mutan sus propios eventos.
  sourceRetry: string;
  // FILE_IMPORT, para el test de punta a punta de "corregir el mapeo y volver a
  // correrlo" (§1 de docs/ingestion-architecture.md).
  sourceMapping: string;
  sourceB: string;
  batchUno: string;
  eventoDeB: string;
}

let fx: Fixture;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", ingestionEventRouter);
  // sourceRouter se monta porque el test de punta a punta corrige el
  // fieldMapping por PATCH real, no escribiendo la columna a mano.
  app.use("/api", sourceRouter);
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
      name: `IngEvents test org ${label} ${randomUUID()}`,
      slug: `ingevents-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `ingevents-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `IngEvents Test ${label}`,
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

interface EventoCreado {
  organizationId: string;
  sourceId: string;
  status: "PENDING" | "PROCESSED" | "FAILED";
  batchId?: string;
  errorMessage?: string;
  rawPayload?: unknown;
}

async function crearEvento(input: EventoCreado): Promise<string> {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      externalId: `ingevents-${randomUUID()}`,
      rawPayload: (input.rawPayload ?? { firstName: "Ana", lastName: "Gómez" }) as never,
      status: input.status,
      batchId: input.batchId ?? null,
      errorMessage: input.errorMessage ?? null,
    },
    select: { id: true },
  });
  return evento.id;
}

function leerEvento(id: string) {
  return prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: { status: true, errorMessage: true, promotedContactId: true },
  });
}

interface RespuestaListado {
  data: {
    id: string;
    sourceId: string;
    batchId: string | null;
    status: string;
    errorMessage: string | null;
  }[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
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

  const mk = (organizationId: string, name: string, type: "WEBHOOK" | "FILE_IMPORT") =>
    prisma.source.create({ data: { organizationId, name, type }, select: { id: true } });

  const sourceList = (await mk(orgA, "Landing listado", "WEBHOOK")).id;
  const sourceRetry = (await mk(orgA, "Landing reproceso", "WEBHOOK")).id;
  const sourceMapping = (await mk(orgA, "Planilla feria", "FILE_IMPORT")).id;
  const sourceB = (await mk(orgB, "Landing B", "WEBHOOK")).id;

  const batchUno = randomUUID();

  // Cinco eventos de solo lectura en sourceList. Los conteos que los tests de
  // filtro afirman salen de acá:
  //   total 5 · FAILED 2 · batchUno 2 · (FAILED ∩ batchUno) 1
  //
  // NINGUNO QUEDA EN PENDING, Y ES UN REQUISITO, NO UNA CASUALIDAD. Un PENDING
  // no es inerte: `drenarPendientes({ organizationId })` barre TODA la
  // organización, así que cualquier test que drene —hay dos más abajo— se
  // llevaría puestos estos eventos y los dejaría en PROCESSED. "De solo
  // lectura" dejaría de ser cierto y los conteos de arriba valdrían solo hasta
  // el primer drenado.
  //
  // Ningún test de filtro consulta PENDING (todos filtran FAILED, DUPLICATE o
  // un valor inválido), así que usar PROCESSED en su lugar deja los cuatro
  // conteos idénticos.
  await crearEvento({ organizationId: orgA, sourceId: sourceList, status: "PROCESSED" });
  await crearEvento({ organizationId: orgA, sourceId: sourceList, status: "PROCESSED" });
  await crearEvento({
    organizationId: orgA,
    sourceId: sourceList,
    status: "FAILED",
    errorMessage: "email: email inválido",
  });
  await crearEvento({
    organizationId: orgA,
    sourceId: sourceList,
    status: "PROCESSED",
    batchId: batchUno,
  });
  await crearEvento({
    organizationId: orgA,
    sourceId: sourceList,
    status: "FAILED",
    batchId: batchUno,
    errorMessage: "lastName: lastName es requerido",
  });

  const eventoDeB = await crearEvento({
    organizationId: orgB,
    sourceId: sourceB,
    status: "FAILED",
    errorMessage: "no debería verse desde A",
  });

  fx = {
    orgA,
    orgB,
    adminA,
    userA,
    adminB,
    sourceList,
    sourceRetry,
    sourceMapping,
    sourceB,
    batchUno,
    eventoDeB,
  };
});

after(async () => {
  if (closeApp) await closeApp();
  if (!fx) return;

  const ambas = { in: [fx.orgA, fx.orgB] };
  // ingestion_events antes que contacts: promoted_contact_id referencia
  // contacts. Y contacts/ingestion_events antes que sources: las FK son
  // RESTRICT.
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: ambas } });
  await prisma.contact.deleteMany({ where: { organizationId: ambas } });
  await prisma.source.deleteMany({ where: { organizationId: ambas } });
  await prisma.user.deleteMany({ where: { organizationId: ambas } });
  await prisma.organization.deleteMany({ where: { id: ambas } });

  for (const u of [fx.adminA, fx.userA, fx.adminB]) {
    await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Listado — la brecha que este endpoint viene a cerrar
// ---------------------------------------------------------------------------

test("GET /api/ingestion-events lista los eventos de una fuente con la proyección pública", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}`,
    fx.adminA.accessToken,
  );
  assert.equal(res.status, 200);

  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 5);
  assert.equal(body.data.length, 5);

  // La proyección: están los campos que hacen diagnosticable una fila…
  const fallida = body.data.find((e) => e.status === "FAILED" && e.batchId === null);
  assert.ok(fallida, "tiene que verse el evento FAILED sin lote");
  assert.equal(fallida.errorMessage, "email: email inválido");
  assert.equal(fallida.sourceId, fx.sourceList);

  // …y NO están las dos columnas JSONB pesadas. Se afirma sobre el objeto real
  // devuelto, no sobre el tipo: un select mal editado se vería acá.
  const crudo = fallida as unknown as Record<string, unknown>;
  assert.equal("rawPayload" in crudo, false, "rawPayload no va en el listado");
  assert.equal("promotionNotes" in crudo, false, "promotionNotes no va en el listado");
});

test("G-2: un evento de WEBHOOK (batchId null) aparece en el listado — antes era invisible", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&status=FAILED`,
    fx.adminA.accessToken,
  );
  const body = (await res.json()) as RespuestaListado;

  const sinLote = body.data.filter((e) => e.batchId === null);
  assert.equal(sinLote.length, 1);
  assert.equal(
    sinLote[0].errorMessage,
    "email: email inválido",
    "el motivo del fallo de un webhook tiene que ser legible sin mirar la base",
  );
});

test("filtro por status", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&status=FAILED`,
    fx.adminA.accessToken,
  );
  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 2);
  assert.ok(body.data.every((e) => e.status === "FAILED"));
});

test("filtro por batchId — sigue cubriendo el caso puntual de 'ver este lote'", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?batchId=${fx.batchUno}`,
    fx.adminA.accessToken,
  );
  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 2);
  assert.ok(body.data.every((e) => e.batchId === fx.batchUno));
});

test("filtros COMBINADOS: sourceId + status + batchId se intersecan, no se pisan", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&status=FAILED&batchId=${fx.batchUno}`,
    fx.adminA.accessToken,
  );
  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 1);
  assert.equal(body.data[0].status, "FAILED");
  assert.equal(body.data[0].batchId, fx.batchUno);
});

test("un status válido del enum que ningún código escribe (DUPLICATE) da una página vacía, no un 400", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&status=DUPLICATE`,
    fx.adminA.accessToken,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 0);
  assert.equal(body.data.length, 0);
});

test("un status que NO existe en el enum da 400", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&status=INVENTADO`,
    fx.adminA.accessToken,
  );
  assert.equal(res.status, 400);
});

test("paginación: pageSize parte el resultado y los totales cierran", async () => {
  const primera = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&page=1&pageSize=2`,
    fx.adminA.accessToken,
  );
  const body1 = (await primera.json()) as RespuestaListado;
  assert.equal(body1.data.length, 2);
  assert.equal(body1.pagination.total, 5);
  assert.equal(body1.pagination.totalPages, 3);
  assert.equal(body1.pagination.pageSize, 2);

  const tercera = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceList}&page=3&pageSize=2`,
    fx.adminA.accessToken,
  );
  const body3 = (await tercera.json()) as RespuestaListado;
  assert.equal(body3.data.length, 1, "la última página trae el resto");

  // Y no se repite ninguna fila entre páginas.
  const idsPagina1 = new Set(body1.data.map((e) => e.id));
  assert.ok(body3.data.every((e) => !idsPagina1.has(e.id)));
});

test("pageSize por encima del máximo da 400", async () => {
  const res = await call("GET", "/api/ingestion-events?pageSize=101", fx.adminA.accessToken);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Aislamiento y autorización
// ---------------------------------------------------------------------------

test("el listado de la organización A no ve NINGÚN evento de la B", async () => {
  const res = await call("GET", "/api/ingestion-events", fx.adminA.accessToken);
  const body = (await res.json()) as RespuestaListado;

  assert.ok(
    body.data.every((e) => e.id !== fx.eventoDeB),
    "un evento de otra organización no puede aparecer",
  );
  assert.ok(
    body.data.every((e) => e.sourceId !== fx.sourceB),
    "tampoco una fuente de otra organización",
  );
});

test("filtrar por el sourceId de OTRA organización devuelve vacío, no los eventos ajenos", async () => {
  const res = await call(
    "GET",
    `/api/ingestion-events?sourceId=${fx.sourceB}`,
    fx.adminA.accessToken,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as RespuestaListado;
  assert.equal(body.pagination.total, 0);
});

test("USER recibe 403 en el listado y en el reproceso: es ADMIN-only, lectura incluida", async () => {
  const listado = await call("GET", "/api/ingestion-events", fx.userA.accessToken);
  assert.equal(listado.status, 403);

  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "FAILED",
    errorMessage: "para el 403",
  });
  const retry = await call("POST", `/api/ingestion-events/${id}/retry`, fx.userA.accessToken);
  assert.equal(retry.status, 403);

  // Y no se tocó nada: el 403 corta antes del service.
  assert.equal((await leerEvento(id)).status, "FAILED");
});

test("sin token no se puede listar ni reprocesar", async () => {
  const listado = await fetch(`${baseUrl}/api/ingestion-events`);
  assert.equal(listado.status, 401);

  const retry = await fetch(`${baseUrl}/api/ingestion-events/${randomUUID()}/retry`, {
    method: "POST",
  });
  assert.equal(retry.status, 401);
});

// ---------------------------------------------------------------------------
// Reproceso (G-7)
// ---------------------------------------------------------------------------

test("POST /retry sobre un FAILED lo devuelve a PENDING y limpia errorMessage", async () => {
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "FAILED",
    errorMessage: "email: email inválido",
  });

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 200);

  const body = (await res.json()) as { id: string; status: string; errorMessage: string | null };
  assert.equal(body.id, id);
  assert.equal(body.status, "PENDING");
  assert.equal(body.errorMessage, null);

  // La afirmación que importa se le pregunta a la base, no a la respuesta.
  const enBase = await leerEvento(id);
  assert.equal(enBase.status, "PENDING");
  assert.equal(enBase.errorMessage, null, "una fila PENDING no puede arrastrar el error anterior");

  // Este test deja a propósito un evento en PENDING —es lo que acaba de
  // afirmar—, así que lo borra antes de terminar: la organización del fixture
  // es compartida y los dos tests de más abajo drenan la cola entera. Ver la
  // nota del `before` sobre por qué acá no puede quedar nada pendiente suelto.
  await prisma.ingestionEvent.delete({ where: { id } });
});

test("DE PUNTA A PUNTA: tras el retry, el worker lo recoge y lo promueve de verdad", async () => {
  const email = `retry-${randomUUID()}@ejemplo.test`;
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "FAILED",
    errorMessage: "falló en su momento",
    rawPayload: { firstName: "Reintento", lastName: "Funciona", email },
  });

  // Control negativo: mientras está en FAILED, el worker NO lo toca. Sin esto
  // el test no probaría que el retry sirvió para algo.
  //
  // SE AFIRMA SOBRE ESTE EVENTO, NO SOBRE EL CONTADOR DEL DRENADO.
  // `drenarPendientes({ organizationId })` barre toda la organización, que es
  // compartida por todos los tests del archivo: `procesados === 0` sería una
  // afirmación sobre el estado global, y se rompería en cuanto otro test dejara
  // cualquier pendiente atrás. Lo que este test tiene que probar es más chico y
  // más preciso — que ESTA fila no fue reclamada — y eso se lee de la fila.
  await drenarPendientes({ organizationId: fx.orgA });

  const trasDrenado = await leerEvento(id);
  assert.equal(trasDrenado.status, "FAILED", "un FAILED no debe ser reclamado por el worker");
  assert.equal(
    trasDrenado.promotedContactId,
    null,
    "y no puede haber promovido ningún contacto estando en FAILED",
  );

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 200);

  // El endpoint NO promueve: solo encola. Después del 200 sigue en PENDING.
  assert.equal((await leerEvento(id)).status, "PENDING");

  // Y ahora sí: claimNextPendingEvent lo recoge en la siguiente pasada. Otra
  // vez sin mirar el contador del drenado, por lo mismo que arriba: que ESTE
  // evento haya terminado PROCESSED con su contacto es la prueba completa de
  // que el worker lo reclamó y lo promovió.
  await drenarPendientes({ organizationId: fx.orgA });

  const final = await leerEvento(id);
  assert.equal(final.status, "PROCESSED");
  assert.ok(final.promotedContactId, "tiene que haber quedado apuntando al contacto promovido");

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: final.promotedContactId! },
  });
  assert.equal(contacto.email, email);
  assert.equal(contacto.organizationId, fx.orgA);
});

test("§1 completo: corregir el fieldMapping y volver a correr el MISMO evento", async () => {
  // La fila se guardó con los encabezados originales del archivo, como hace la
  // importación real — sin traducir.
  const email = `mapeo-${randomUUID()}@ejemplo.test`;
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceMapping,
    status: "PENDING",
    rawPayload: { Nombre: "Mapeo", Apellido: "Corregido", Mail: email },
  });

  // Con el mapeo MAL (apunta a columnas que el archivo no trae), la promoción
  // marca la fila FAILED con un motivo útil.
  let patch = await call("PATCH", `/api/sources/${fx.sourceMapping}`, fx.adminA.accessToken, {
    fieldMapping: { NombreDePila: "firstName", ApellidoPaterno: "lastName" },
  });
  assert.equal(patch.status, 200);

  await drenarPendientes({ organizationId: fx.orgA });
  const fallido = await leerEvento(id);
  assert.equal(fallido.status, "FAILED");
  assert.match(fallido.errorMessage ?? "", /ninguna columna del fieldMapping existe/);

  // Se corrige el mapeo…
  patch = await call("PATCH", `/api/sources/${fx.sourceMapping}`, fx.adminA.accessToken, {
    fieldMapping: { Nombre: "firstName", Apellido: "lastName", Mail: "email" },
  });
  assert.equal(patch.status, 200);

  // …y se vuelve a correr el MISMO evento, sin volver a subir el archivo. Esto
  // es literalmente la promesa de §1, que hasta ahora no tenía endpoint.
  const retry = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(retry.status, 200);

  await drenarPendientes({ organizationId: fx.orgA });
  const final = await leerEvento(id);
  assert.equal(final.status, "PROCESSED");

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: final.promotedContactId! },
  });
  assert.equal(contacto.firstName, "Mapeo");
  assert.equal(contacto.email, email);
});

test("409 sobre un evento PENDING — solo FAILED se puede reprocesar", async () => {
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "PENDING",
  });

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 409);

  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /PENDING/);
  assert.equal((await leerEvento(id)).status, "PENDING", "el 409 no puede haber tocado la fila");

  // Mismo motivo que en el retry de más arriba: no se deja un PENDING vivo en
  // la organización compartida.
  await prisma.ingestionEvent.delete({ where: { id } });
});

test("409 sobre un evento PROCESSED — reprocesar uno ya promovido duplicaría trabajo", async () => {
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "PROCESSED",
  });

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 409);

  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /PROCESSED/);
  assert.equal((await leerEvento(id)).status, "PROCESSED");
});

test("reprocesar dos veces: la primera 200, la segunda 409 — no es idempotente", async () => {
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "FAILED",
    errorMessage: "primer intento",
  });

  const primera = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(primera.status, 200);

  const segunda = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(segunda.status, 409);

  // La primera llamada lo dejó en PENDING: mismo motivo que arriba.
  await prisma.ingestionEvent.delete({ where: { id } });
});

test("404 cross-organización: B no puede reprocesar un evento de A, ni al revés", async () => {
  const deA = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fx.sourceRetry,
    status: "FAILED",
    errorMessage: "de A",
  });

  const res = await call("POST", `/api/ingestion-events/${deA}/retry`, fx.adminB.accessToken);
  assert.equal(res.status, 404, "para B ese evento no existe");

  // Y sigue intacto: el 404 no puede ser un efecto colateral de haberlo tocado.
  const enBase = await leerEvento(deA);
  assert.equal(enBase.status, "FAILED");
  assert.equal(enBase.errorMessage, "de A");

  // El evento de B tampoco es alcanzable desde A.
  const alReves = await call(
    "POST",
    `/api/ingestion-events/${fx.eventoDeB}/retry`,
    fx.adminA.accessToken,
  );
  assert.equal(alReves.status, 404);
});

test("404 sobre un id que no existe en ninguna organización", async () => {
  const res = await call(
    "POST",
    `/api/ingestion-events/${randomUUID()}/retry`,
    fx.adminA.accessToken,
  );
  assert.equal(res.status, 404);
});

test("un id que no es uuid da 400, no 404 ni 500", async () => {
  const res = await call("POST", "/api/ingestion-events/no-es-uuid/retry", fx.adminA.accessToken);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// V-9 (docs/auditoria-2026-08-29.md) — el retry era el camino SIN carrera para
// promover un evento de una fuente pausada o retirada: solo miraba que el
// evento siguiera en FAILED, nunca la Source. Un FAILED de hace semanas, con
// la fuente pausada mientras tanto, volvía a PENDING y el worker lo promovía.
//
// Cada test crea SU PROPIA fuente en el estado que prueba, en vez de pausar
// sourceRetry: esa la comparten los tests de arriba y un isActive: false a
// mitad de archivo les cambiaría el resultado. El evento se crea directo en
// la base —POST /ingest ya rechaza la creación con la fuente pausada—, que es
// exactamente la situación del hallazgo: la fila existía de antes.
// ---------------------------------------------------------------------------

test("V-9: 409 sobre un FAILED cuya fuente está PAUSADA — no vuelve a PENDING", async () => {
  const fuentePausada = await prisma.source.create({
    data: { organizationId: fx.orgA, name: "Landing pausada", type: "WEBHOOK", isActive: false },
    select: { id: true },
  });
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fuentePausada.id,
    status: "FAILED",
    errorMessage: "falló cuando la fuente estaba activa",
  });

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /pausada/);

  const enBase = await leerEvento(id);
  assert.equal(enBase.status, "FAILED", "el 409 no puede haber encolado la fila");
  assert.equal(
    enBase.errorMessage,
    "falló cuando la fuente estaba activa",
    "y tampoco puede haber limpiado el motivo del fallo original",
  );

  await prisma.ingestionEvent.delete({ where: { id } });
});

test("V-9: 409 sobre un FAILED cuya fuente fue RETIRADA (deletedAt) — no vuelve a PENDING", async () => {
  const fuenteRetirada = await prisma.source.create({
    data: {
      organizationId: fx.orgA,
      name: "Landing retirada",
      type: "WEBHOOK",
      deletedAt: new Date(),
    },
    select: { id: true },
  });
  const id = await crearEvento({
    organizationId: fx.orgA,
    sourceId: fuenteRetirada.id,
    status: "FAILED",
    errorMessage: "falló antes de retirar la fuente",
  });

  const res = await call("POST", `/api/ingestion-events/${id}/retry`, fx.adminA.accessToken);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /retirada/);

  const enBase = await leerEvento(id);
  assert.equal(enBase.status, "FAILED");
  assert.equal(enBase.errorMessage, "falló antes de retirar la fuente");

  await prisma.ingestionEvent.delete({ where: { id } });
});
