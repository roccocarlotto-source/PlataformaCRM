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
import { MARCADOR_DE_DATO_BORRADO } from "../repositories/contact.repository";
import { findRoleByName } from "../repositories/role.repository";
import { contactRouter } from "../routes/contact.routes";

// ---------------------------------------------------------------------------
// POST /api/contacts/:id/erase-personal-data — D2-4 de
// docs/review-fase2-2026-08-28.md. HTTP real contra una app Express real, con
// el router real —su authenticate, su authorize y su rate limiter— contra
// Postgres y GoTrue reales. Mismo patrón que
// ingestionEvent.controller.integration-test.ts.
//
// LE PREGUNTA A LA BASE, NO AL ENDPOINT: que el contacto quedó anonimizado y
// que el rawPayload desapareció se lee de vuelta de `contacts` y de
// `ingestion_events`, nunca del JSON que devolvió la respuesta — que es
// justamente lo que un bug podría estar construyendo bien mientras escribe
// mal.
// ---------------------------------------------------------------------------

const PASSWORD = "ContactErase-test-password-123!";

interface FixtureUser {
  accessToken: string;
}

let orgA: string;
let orgB: string;
let adminA: FixtureUser;
let userA: FixtureUser;
let adminB: FixtureUser;
let sourceA: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", contactRouter);
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
      name: `Erase test org ${label} ${randomUUID()}`,
      slug: `erase-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `erase-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Erase Test ${label}`,
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

  return { accessToken: signInData.session.access_token };
}

function call(method: string, path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
}

// Un contacto con TODOS los campos de PII poblados, y un evento de ingesta que
// lo promovió con su fila cruda intacta. Es el estado del que parte cada test:
// si alguno se creara vacío, el borrado no probaría nada.
async function crearContactoConEvento(organizationId: string, sourceId: string) {
  // El email se arma acá y no se lee de vuelta del select: la columna es
  // nullable, y lo que los tests necesitan es el string que se escribió.
  const email = `ana-${randomUUID().slice(0, 8)}@ejemplo.test`;

  const contacto = await prisma.contact.create({
    data: {
      organizationId,
      firstName: "Ana",
      lastName: "Gómez",
      email,
      phone: "+54 11 5555-5555",
      jobTitle: "Directora de Compras",
    },
    select: { id: true },
  });

  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId,
      sourceId,
      externalId: `erase-${randomUUID()}`,
      rawPayload: {
        Nombre: "Ana",
        Apellido: "Gómez",
        Mail: email,
        Telefono: "+54 11 5555-5555",
      },
      status: "PROCESSED",
      promotedContactId: contacto.id,
    },
    select: { id: true },
  });

  return { contactId: contacto.id, email, eventoId: evento.id };
}

function leerContacto(id: string) {
  return prisma.contact.findUniqueOrThrow({
    where: { id },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      jobTitle: true,
      deletedAt: true,
    },
  });
}

function leerEvento(id: string) {
  return prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: { rawPayload: true, promotedContactId: true, status: true },
  });
}

before(async () => {
  orgA = await createOrganization("a");
  orgB = await createOrganization("b");

  adminA = await createFixtureUser("admin-a", orgA, "ADMIN");
  userA = await createFixtureUser("user-a", orgA, "USER");
  adminB = await createFixtureUser("admin-b", orgB, "ADMIN");

  const source = await prisma.source.create({
    data: { organizationId: orgA, name: "Landing de borrado", type: "WEBHOOK" },
    select: { id: true },
  });
  sourceA = source.id;

  const app = await startTestApp();
  baseUrl = app.url;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    // ingestion_events antes que contacts: promoted_contact_id los referencia.
    await prisma.ingestionEvent.deleteMany({ where: { organizationId: org } });
    await prisma.contact.deleteMany({ where: { organizationId: org } });
    await prisma.source.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
  }
});

// ---------------------------------------------------------------------------
// El caso central
// ---------------------------------------------------------------------------

test("anonimiza el contacto y borra el rawPayload de sus eventos de ingesta", async () => {
  const { contactId, email, eventoId } = await crearContactoConEvento(orgA, sourceA);

  const res = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    adminA.accessToken,
  );
  assert.equal(res.status, 200);

  const body = (await res.json()) as { contactId: string; ingestionEventsAnonimizados: number };
  assert.equal(body.contactId, contactId);
  assert.equal(body.ingestionEventsAnonimizados, 1);

  const contacto = await leerContacto(contactId);
  assert.equal(contacto.firstName, MARCADOR_DE_DATO_BORRADO);
  assert.equal(contacto.lastName, MARCADOR_DE_DATO_BORRADO);
  assert.equal(contacto.email, null, "email va a NULL, no a un marcador: hay un único parcial");
  assert.equal(contacto.phone, null);
  assert.equal(contacto.jobTitle, null);

  const evento = await leerEvento(eventoId);
  assert.deepEqual(evento.rawPayload, { erased: true });

  // El email original no puede sobrevivir en NINGUNA de las dos filas.
  assert.ok(!JSON.stringify(evento.rawPayload).includes(email));
});

// ---------------------------------------------------------------------------
// La diferencia con el soft delete es el punto entero del hallazgo: son dos
// operaciones distintas y esta no hace la otra.
// ---------------------------------------------------------------------------

test("NO toca deletedAt: borrar datos no es lo mismo que ocultar el registro", async () => {
  const { contactId } = await crearContactoConEvento(orgA, sourceA);

  const res = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    adminA.accessToken,
  );
  assert.equal(res.status, 200);

  const contacto = await leerContacto(contactId);
  assert.equal(contacto.deletedAt, null, "el borrado de datos no soft-deletea el contacto");
});

test("el vínculo del evento con el contacto sobrevive: se borró el dato, no el historial", async () => {
  const { contactId, eventoId } = await crearContactoConEvento(orgA, sourceA);

  await call("POST", `/api/contacts/${contactId}/erase-personal-data`, adminA.accessToken);

  const evento = await leerEvento(eventoId);
  assert.equal(evento.promotedContactId, contactId);
  assert.equal(evento.status, "PROCESSED");
});

// ---------------------------------------------------------------------------
// Repetible: un borrado a pedido que revienta cuando se repite obliga a quien
// lo opera a llevar la cuenta de qué ya pidió.
// ---------------------------------------------------------------------------

test("es idempotente — pedirlo dos veces no falla", async () => {
  const { contactId } = await crearContactoConEvento(orgA, sourceA);

  const primera = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    adminA.accessToken,
  );
  assert.equal(primera.status, 200);

  const segunda = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    adminA.accessToken,
  );
  assert.equal(segunda.status, 200);

  const contacto = await leerContacto(contactId);
  assert.equal(contacto.firstName, MARCADOR_DE_DATO_BORRADO);
});

// Dos borrados en la MISMA organización: el caso que rompería si el email se
// reemplazara por un marcador fijo en vez de NULL, por contacts_org_email_unique.
test("dos contactos distintos de la misma organización se pueden borrar los dos", async () => {
  const uno = await crearContactoConEvento(orgA, sourceA);
  const dos = await crearContactoConEvento(orgA, sourceA);

  const r1 = await call(
    "POST",
    `/api/contacts/${uno.contactId}/erase-personal-data`,
    adminA.accessToken,
  );
  const r2 = await call(
    "POST",
    `/api/contacts/${dos.contactId}/erase-personal-data`,
    adminA.accessToken,
  );

  assert.equal(r1.status, 200);
  assert.equal(
    r2.status,
    200,
    "el segundo borrado no puede chocar contra el único parcial de email",
  );

  assert.equal((await leerContacto(uno.contactId)).email, null);
  assert.equal((await leerContacto(dos.contactId)).email, null);
});

// ---------------------------------------------------------------------------
// Autorización y aislamiento, con el mismo criterio que el resto del módulo.
// ---------------------------------------------------------------------------

test("un USER no puede borrar datos personales: 403", async () => {
  const { contactId } = await crearContactoConEvento(orgA, sourceA);

  const res = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    userA.accessToken,
  );
  assert.equal(res.status, 403);

  const contacto = await leerContacto(contactId);
  assert.equal(contacto.firstName, "Ana", "el 403 no puede haber borrado nada");
});

test("sin token: 401", async () => {
  const { contactId } = await crearContactoConEvento(orgA, sourceA);

  const res = await fetch(`${baseUrl}/api/contacts/${contactId}/erase-personal-data`, {
    method: "POST",
  });
  assert.equal(res.status, 401);
});

test("el ADMIN de otra organización recibe 404, y no borra nada", async () => {
  const { contactId } = await crearContactoConEvento(orgA, sourceA);

  const res = await call(
    "POST",
    `/api/contacts/${contactId}/erase-personal-data`,
    adminB.accessToken,
  );
  // 404 y no 403: no se confirma la existencia de recursos ajenos, mismo
  // criterio que el resto de los endpoints de Contact.
  assert.equal(res.status, 404);

  const contacto = await leerContacto(contactId);
  assert.equal(contacto.firstName, "Ana", "un pedido cross-organización no puede tocar la fila");
  assert.notEqual(contacto.email, null);
});

test("un contacto inexistente da 404", async () => {
  const res = await call(
    "POST",
    `/api/contacts/${randomUUID()}/erase-personal-data`,
    adminA.accessToken,
  );
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// El borrado no puede desbordar la organización.
// ---------------------------------------------------------------------------

test("no toca eventos de ingesta de otra organización", async () => {
  const sourceDeB = await prisma.source.create({
    data: { organizationId: orgB, name: "Fuente de B", type: "WEBHOOK" },
    select: { id: true },
  });
  const ajeno = await crearContactoConEvento(orgB, sourceDeB.id);
  const propio = await crearContactoConEvento(orgA, sourceA);

  await call("POST", `/api/contacts/${propio.contactId}/erase-personal-data`, adminA.accessToken);

  const eventoAjeno = await leerEvento(ajeno.eventoId);
  assert.notDeepEqual(eventoAjeno.rawPayload, { erased: true });
  assert.equal((await leerContacto(ajeno.contactId)).firstName, "Ana");
});
