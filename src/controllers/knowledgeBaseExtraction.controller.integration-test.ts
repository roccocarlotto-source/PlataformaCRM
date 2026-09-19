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
import { KNOWLEDGE_BASE_EXTRACT_MAX } from "../middlewares/rateLimit";
import { findRoleByName } from "../repositories/role.repository";
import { knowledgeBaseEntryRouter } from "../routes/knowledgeBaseEntry.routes";
import {
  KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES,
  MAX_CARACTERES_EXTRAIDOS,
  MIMETYPE_DOCX,
  MIMETYPE_PDF,
  MIMETYPE_TXT,
} from "../services/knowledgeBaseExtraction.service";
import {
  construirDocx,
  construirPdf,
  construirTxt,
} from "../services/knowledgeBaseExtraction.test-helper";

// ---------------------------------------------------------------------------
// POST /api/knowledge-base/extract-text (ítem 60 de
// docs/frontend-cambios-pendientes.md) por HTTP real contra una app Express
// real, montando el ROUTER REAL —con su authenticate, su authorize, su rate
// limiter propio y su middleware de subida— y subiendo archivos de verdad por
// multipart. Mismo patrón que import.controller.integration-test.ts.
//
// Lo que se prueba acá y NO puede probarse en el unitario del servicio (que ya
// cubre el parseo de los tres formatos, la corrupción y el documento vacío):
//
//   1. La cadena de middlewares completa y en su orden: sin token 401, un USER
//      403 sin que el archivo se llegue a parsear, un ADMIN pasa.
//   2. multer de verdad: el 413 por tamaño y el 400 por mimetype, que son del
//      middleware y no del servicio.
//   3. Que los AppError del servicio salen con SU status por HTTP (400/422) y
//      no convertidos en 500 por errorHandler.
//   4. Que el limiter propio está efectivamente enganchado a esta ruta.
//
// CADA GRUPO DE CASOS USA SU PROPIO ADMIN, y no es cosmético: el limiter es de
// 10 por minuto POR IDENTIDAD, así que un solo usuario para todo el archivo
// empezaría a recibir 429 a mitad de camino. Repartirlo es lo que permite
// ejercitar la ruta real en vez de montar una copia con el límite subido.
//
// ORGANIZACIÓN PROPIA de este archivo, como el resto de la suite de
// integración: el runner corre los archivos en paralelo contra una base
// compartida.
// ---------------------------------------------------------------------------

const PASSWORD = "Kb-extract-test-password-123!";
const TZ = "America/Montevideo";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let organizationId: string;
let adminFormatos: FixtureUser;
let adminErrores: FixtureUser;
let adminLimite: FixtureUser;
let usuarioComun: FixtureUser;
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

async function createFixtureUser(label: string, role: "ADMIN" | "USER"): Promise<FixtureUser> {
  const email = `kb-extract-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `KB Extract ${label}`,
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

// Sube un archivo por multipart REAL (FormData + Blob, nativos en Node 18+),
// igual que import.controller.integration-test.ts: el objetivo es ejercitar
// multer de verdad, no simular su parseo. El mimetype del Blob es lo que el
// fileFilter del middleware mira.
function extraer(
  token: string | null,
  contenido: Buffer | string,
  mimetype: string,
  nombre = "documento",
  campo = "file",
): Promise<Response> {
  const form = new FormData();
  form.append(campo, new Blob([contenido], { type: mimetype }), nombre);

  return fetch(`${baseUrl}/api/knowledge-base/extract-text`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

async function cuerpoDeExito(res: Response): Promise<{ text: string; truncated: boolean }> {
  const crudo = await res.text();
  assert.equal(res.status, 200, `no devolvió 200: ${crudo}`);
  return JSON.parse(crudo) as { text: string; truncated: boolean };
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `KB extract ${randomUUID()}`,
      slug: `kb-extract-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  organizationId = org.id;
  await prisma.branch.create({ data: { organizationId, name: "Sucursal única", timezone: TZ } });

  adminFormatos = await createFixtureUser("formatos", "ADMIN");
  adminErrores = await createFixtureUser("errores", "ADMIN");
  adminLimite = await createFixtureUser("limite", "ADMIN");
  usuarioComun = await createFixtureUser("user", "USER");
});

after(async () => {
  if (closeApp) await closeApp();
  if (organizationId) {
    await prisma.branch.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  for (const u of [adminFormatos, adminErrores, adminLimite, usuarioComun]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Los tres formatos, con archivos de verdad
// ---------------------------------------------------------------------------

test("un .txt devuelve su texto con truncated: false", async () => {
  const res = await extraer(
    adminFormatos.accessToken,
    construirTxt("Atendemos de lunes a viernes de 9 a 18."),
    MIMETYPE_TXT,
    "horarios.txt",
  );

  const body = await cuerpoDeExito(res);
  assert.equal(body.text, "Atendemos de lunes a viernes de 9 a 18.");
  assert.equal(body.truncated, false);
});

test("un .docx devuelve el texto de sus párrafos", async () => {
  const res = await extraer(
    adminFormatos.accessToken,
    construirDocx(["Política de cancelación", "Se puede cancelar hasta 24 h antes."]),
    MIMETYPE_DOCX,
    "politica.docx",
  );

  const body = await cuerpoDeExito(res);
  assert.match(body.text, /Política de cancelación/);
  assert.match(body.text, /hasta 24 h antes\./);
  assert.equal(body.truncated, false);
});

test("un .pdf con texto seleccionable devuelve su texto", async () => {
  const res = await extraer(
    adminFormatos.accessToken,
    construirPdf("Formas de pago aceptadas"),
    MIMETYPE_PDF,
    "pagos.pdf",
  );

  const body = await cuerpoDeExito(res);
  assert.match(body.text, /Formas de pago aceptadas/);
  assert.equal(body.truncated, false);
});

test("un archivo más largo que el tope vuelve recortado y con truncated: true", async () => {
  const res = await extraer(
    adminFormatos.accessToken,
    construirTxt("a".repeat(MAX_CARACTERES_EXTRAIDOS + 500)),
    MIMETYPE_TXT,
    "larguisimo.txt",
  );

  const body = await cuerpoDeExito(res);
  assert.equal(body.text.length, MAX_CARACTERES_EXTRAIDOS);
  assert.equal(body.truncated, true);
});

// ---------------------------------------------------------------------------
// Los errores: cada uno con SU status, no un 500 genérico
// ---------------------------------------------------------------------------

test("un mimetype fuera de la lista es 400 y lo dice en castellano", async () => {
  // El .doc binario viejo: el caso concreto que este endpoint NO soporta a
  // propósito. Lo corta el fileFilter del middleware, antes de leer el archivo.
  const res = await extraer(
    adminErrores.accessToken,
    construirTxt("da igual"),
    "application/msword",
    "politica.doc",
  );

  assert.equal(res.status, 400);
  assert.equal(await mensajeDeError(res), "Formato no soportado: se aceptan .txt, .docx y .pdf");
});

test("un archivo por encima del tope de 5 MB es 413, no el 500 que daría sin traducir", async () => {
  // El tope se ejercita mandando un cuerpo real que lo supera, no simulando el
  // error de multer. Sin la traducción de knowledgeBaseUpload, un MulterError
  // no es un AppError y errorHandler lo mandaría a 500 — un error del servidor
  // por algo que hizo el cliente.
  const gigante = Buffer.alloc(KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES + 1024, "x");

  const res = await extraer(adminErrores.accessToken, gigante, MIMETYPE_TXT, "gigante.txt");

  assert.equal(res.status, 413);
});

test("un PDF sin texto extraíble es 422 y explica el caso del escaneado", async () => {
  const res = await extraer(
    adminErrores.accessToken,
    construirPdf(null),
    MIMETYPE_PDF,
    "escaneado.pdf",
  );

  assert.equal(res.status, 422);
  const mensaje = await mensajeDeError(res);
  assert.match(mensaje, /PDF escaneado/);
  assert.match(mensaje, /copiarlo y pegarlo a mano/);
});

test("un .txt que en realidad es binario es 400", async () => {
  const res = await extraer(
    adminErrores.accessToken,
    Buffer.from([0x48, 0x6f, 0x6c, 0x61, 0x00, 0x01]),
    MIMETYPE_TXT,
    "roto.txt",
  );

  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /no parece ser texto plano/);
});

test("un .docx corrupto es 400, no 500", async () => {
  const res = await extraer(
    adminErrores.accessToken,
    Buffer.from("esto no es un docx"),
    MIMETYPE_DOCX,
    "roto.docx",
  );

  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /No se pudo leer el archivo Word/);
});

test("un .pdf corrupto es 400, no 500", async () => {
  const res = await extraer(
    adminErrores.accessToken,
    Buffer.from("%PDF-1.4 y nada más"),
    MIMETYPE_PDF,
    "roto.pdf",
  );

  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /No se pudo leer el PDF/);
});

test("un multipart sin el campo 'file' es 400 con el nombre del campo esperado", async () => {
  const res = await extraer(
    adminErrores.accessToken,
    construirTxt("Horarios"),
    MIMETYPE_TXT,
    "horarios.txt",
    "archivo",
  );

  assert.equal(res.status, 400);
  assert.match(await mensajeDeError(res), /"file"/);
});

// ---------------------------------------------------------------------------
// La cadena de auth
// ---------------------------------------------------------------------------

test("sin token es 401 y nunca llega al parseo", async () => {
  const res = await extraer(null, construirTxt("Horarios"), MIMETYPE_TXT, "horarios.txt");

  assert.equal(res.status, 401);
});

test("un USER autenticado es 403: subir a la base de conocimiento es de ADMIN", async () => {
  const res = await extraer(
    usuarioComun.accessToken,
    construirTxt("Horarios"),
    MIMETYPE_TXT,
    "horarios.txt",
  );

  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// El limiter propio
// ---------------------------------------------------------------------------

test("el endpoint tiene su propio rate limit por identidad", async () => {
  // Que el limiter EXISTA en el módulo no prueba que esté enganchado a esta
  // ruta; eso solo se ve agotándolo contra el router real. Se usa un ADMIN
  // dedicado justamente para que agotarlo no le saque el cupo a los demás
  // casos de este archivo.
  for (let i = 0; i < KNOWLEDGE_BASE_EXTRACT_MAX; i += 1) {
    const res = await extraer(
      adminLimite.accessToken,
      construirTxt("Horarios"),
      MIMETYPE_TXT,
      "horarios.txt",
    );
    assert.equal(res.status, 200, `la request ${i + 1} debería entrar en la cuota`);
  }

  const bloqueada = await extraer(
    adminLimite.accessToken,
    construirTxt("Horarios"),
    MIMETYPE_TXT,
    "horarios.txt",
  );

  assert.equal(bloqueada.status, 429);
});
