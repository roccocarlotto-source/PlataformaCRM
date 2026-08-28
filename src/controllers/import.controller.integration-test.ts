import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { importRouter } from "../routes/import.routes";
import { sourceRouter } from "../routes/source.routes";
import { IMPORT_MAX_FILE_BYTES } from "../utils/spreadsheet";
import { drenarPendientes } from "../workers/ingestionWorker";

// ---------------------------------------------------------------------------
// Importación de Excel/CSV (ítem 5 de docs/ingestion-architecture.md §6),
// end-to-end: HTTP real contra Postgres y Supabase Auth reales, con los routers
// reales y su authenticate/authorize/rate limiter. Sin mocks.
//
// LO QUE MÁS SE VIGILA ACÁ es lo más fácil de romper sin darse cuenta: que la
// fila guardada en staging conserve los ENCABEZADOS ORIGINALES del archivo. Si
// alguna vez se "optimizara" traduciendo al parsear, todos los demás tests
// seguirían pasando y solo este lo vería — junto con la promesa de §1 de poder
// corregir un mapeo y volver a correrlo, que quedaría rota en silencio.
// ---------------------------------------------------------------------------

const PASSWORD = "Import-test-password-123!";

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let orgId: string;
let admin: FixtureUser;
let usuarioComun: FixtureUser;
let sourceFile: string;
let sourceWebhook: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", sourceRouter);
  app.use("/api", importRouter);
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

async function crearUsuario(label: string, role: "ADMIN" | "USER"): Promise<FixtureUser> {
  const email = `import-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real (${label}): ${error?.message}`);
  }

  const roleRow = await findRoleByName(role);
  if (!roleRow) throw new Error(`No está sembrado el rol ${role}`);

  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: orgId,
      roleId: roleRow.id,
      email,
      fullName: `Import Test ${label}`,
    },
  });

  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !signIn.session) {
    throw new Error(`No se pudo iniciar sesión (${label}): ${signInError?.message}`);
  }

  return { accessToken: signIn.session.access_token, authUserId: data.user.id };
}

// Sube un archivo por multipart real (FormData + Blob, nativos en Node 18+):
// nada de simular el parseo, el objetivo es ejercitar multer de verdad.
function subir(
  token: string,
  sourceId: string,
  nombre: string,
  contenido: Buffer | string,
): Promise<Response> {
  const form = new FormData();
  form.append("sourceId", sourceId);
  form.append("file", new Blob([contenido]), nombre);

  return fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

function api(method: string, path: string, token: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function crearSource(nombre: string, type: "FILE_IMPORT" | "WEBHOOK") {
  const source = await prisma.source.create({
    data: { organizationId: orgId, name: nombre, type },
    select: { id: true },
  });
  return source.id;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Import test org ${randomUUID()}`,
      slug: `import-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  admin = await crearUsuario("admin", "ADMIN");
  usuarioComun = await crearUsuario("user", "USER");

  sourceFile = await crearSource("Feria de marzo", "FILE_IMPORT");
  sourceWebhook = await crearSource("Landing de precios", "WEBHOOK");
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;

  await prisma.ingestionEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.contact.deleteMany({ where: { organizationId: orgId } });
  await prisma.source.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });

  for (const u of [admin, usuarioComun]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// fieldMapping por el PATCH existente
// ---------------------------------------------------------------------------

test("PATCH /api/sources/:id acepta fieldMapping y lo persiste", async () => {
  const mapeo = { Nombre: "firstName", Apellido: "lastName", Mail: "email" };

  const res = await api("PATCH", `/api/sources/${sourceFile}`, admin.accessToken, {
    fieldMapping: mapeo,
  });
  assert.equal(res.status, 200);

  const body = (await res.json()) as { fieldMapping: unknown };
  assert.deepEqual(body.fieldMapping, mapeo, "la respuesta expone lo que quedó guardado");

  // Y se lee de vuelta DE LA BASE, no de la respuesta.
  const fila = await prisma.source.findUniqueOrThrow({
    where: { id: sourceFile },
    select: { fieldMapping: true },
  });
  assert.deepEqual(fila.fieldMapping, mapeo);
});

test("un destino que no es un campo reconocido de Contact se rechaza con 400", async () => {
  // organizationId es una columna REAL de contacts: si el destino no estuviera
  // restringido, una planilla podría reescribir a qué organización pertenece un
  // contacto.
  const res = await api("PATCH", `/api/sources/${sourceFile}`, admin.accessToken, {
    fieldMapping: { Col: "organizationId" },
  });

  assert.equal(res.status, 400);
});

test("fieldMapping se RECHAZA en una fuente WEBHOOK — type es inmutable, nunca podría servir", async () => {
  const res = await api("PATCH", `/api/sources/${sourceWebhook}`, admin.accessToken, {
    fieldMapping: { Nombre: "firstName" },
  });

  assert.equal(res.status, 400);

  const fila = await prisma.source.findUniqueOrThrow({
    where: { id: sourceWebhook },
    select: { fieldMapping: true },
  });
  assert.equal(fila.fieldMapping, null, "no puede haber quedado escrito nada");
});

test("mandar fieldMapping: null limpia el mapeo (y no escribe un JSON null)", async () => {
  const temporal = await crearSource("Limpiable", "FILE_IMPORT");

  await api("PATCH", `/api/sources/${temporal}`, admin.accessToken, {
    fieldMapping: { Nombre: "firstName" },
  });
  await api("PATCH", `/api/sources/${temporal}`, admin.accessToken, {
    fieldMapping: null,
  });

  // SQL NULL, no JSON null: un JSON null sería un valor presente y la promoción
  // creería que hay un mapeo configurado y vacío.
  const [fila] = await prisma.$queryRaw<{ es_sql_null: boolean }[]>`
    SELECT field_mapping IS NULL AS es_sql_null
    FROM sources WHERE id = ${temporal}::uuid
  `;
  assert.equal(fila.es_sql_null, true);
});

// ---------------------------------------------------------------------------
// La subida
// ---------------------------------------------------------------------------

test("un CSV válido crea N eventos con el MISMO batchId y el payload SIN TRADUCIR", async () => {
  const source = await crearSource("Sin traducir", "FILE_IMPORT");
  const csv = [
    "Nombre,Apellido,Mail",
    "Ana,Gómez,ana@ejemplo.test",
    "Beto,Pérez,beto@ejemplo.test",
    "Caro,Díaz,caro@ejemplo.test",
  ].join("\n");

  const res = await subir(admin.accessToken, source, "leads.csv", csv);
  assert.equal(res.status, 202);

  const body = (await res.json()) as {
    batchId: string;
    encabezados: string[];
    filasLeidas: number;
    insertados: number;
    duplicados: number;
  };

  assert.equal(body.filasLeidas, 3);
  assert.equal(body.insertados, 3);
  assert.equal(body.duplicados, 0);
  assert.deepEqual(body.encabezados, ["Nombre", "Apellido", "Mail"]);

  const eventos = await prisma.ingestionEvent.findMany({
    where: { organizationId: orgId, batchId: body.batchId },
    select: { rawPayload: true, status: true, sourceId: true, batchId: true },
    orderBy: { createdAt: "asc" },
  });

  assert.equal(eventos.length, 3, "las 3 filas comparten un solo batchId");
  for (const evento of eventos) {
    assert.equal(evento.batchId, body.batchId);
    assert.equal(evento.sourceId, source);
    assert.equal(evento.status, "PENDING");
  }

  // ═══ LA AFIRMACIÓN QUE MÁS IMPORTA DE TODO EL ARCHIVO ═══
  // El payload guardado tiene los encabezados ORIGINALES, no los campos de
  // Contact. Traducir acá haría irreversible un mapeo mal configurado y
  // rompería §1 en silencio.
  assert.deepEqual(eventos[0].rawPayload, {
    Nombre: "Ana",
    Apellido: "Gómez",
    Mail: "ana@ejemplo.test",
  });
  for (const evento of eventos) {
    const claves = Object.keys(evento.rawPayload as object);
    assert.deepEqual(claves.sort(), ["Apellido", "Mail", "Nombre"]);
    for (const prohibida of ["firstName", "lastName", "email"]) {
      assert.ok(
        !claves.includes(prohibida),
        `staging no puede tener la clave traducida "${prohibida}"`,
      );
    }
  }
});

test("subir el MISMO archivo dos veces no duplica: la segunda vez todo es duplicado", async () => {
  const source = await crearSource("Dos veces", "FILE_IMPORT");
  const csv = "Nombre,Mail\nAna,ana-dosveces@ejemplo.test\nBeto,beto-dosveces@ejemplo.test";

  const primera = (await (await subir(admin.accessToken, source, "l.csv", csv)).json()) as {
    insertados: number;
    batchId: string;
  };
  const segunda = (await (await subir(admin.accessToken, source, "l.csv", csv)).json()) as {
    insertados: number;
    duplicados: number;
    batchId: string;
  };

  assert.equal(primera.insertados, 2);
  assert.equal(segunda.insertados, 0);
  assert.equal(segunda.duplicados, 2);

  // §4: "un Excel que se sube dos veces" no puede duplicar. Se cuenta en la
  // tabla, no en la respuesta.
  assert.equal(
    await prisma.ingestionEvent.count({ where: { organizationId: orgId, sourceId: source } }),
    2,
  );
  // Y las filas duplicadas siguen perteneciendo al lote que las trajo.
  assert.equal(
    await prisma.ingestionEvent.count({
      where: { organizationId: orgId, batchId: segunda.batchId },
    }),
    0,
  );

  // CONSECUENCIA VISIBLE de lo anterior, fijada acá porque §9.9 la documenta y
  // un documento que describe mal el comportamiento es peor que no tenerlo: el
  // batchId de la segunda subida no tiene NINGÚN evento propio, y getResumenDeLote
  // devuelve null cuando el total es 0. Así que el GET no contesta un resumen en
  // cero — contesta 404, igual que un batchId inventado. El número `duplicados`
  // de la respuesta del POST es la única superficie donde el re-envío se ve.
  const resumen = await api("GET", `/api/imports/${segunda.batchId}`, admin.accessToken);
  assert.equal(resumen.status, 404);
});

test("dos filas IDÉNTICAS del mismo archivo son dos eventos, no un duplicado", async () => {
  const source = await crearSource("Filas repetidas", "FILE_IMPORT");
  const csv = [
    "Nombre,Mail",
    "Ana,ana-repe@ejemplo.test",
    "Ana,ana-repe@ejemplo.test",
    "Beto,beto-repe@ejemplo.test",
  ].join("\n");

  const res = await subir(admin.accessToken, source, "repetidas.csv", csv);
  assert.equal(res.status, 202);

  const body = (await res.json()) as {
    batchId: string;
    filasLeidas: number;
    insertados: number;
    duplicados: number;
  };

  // Dos filas de contenido idéntico son DOS LEADS, no uno repetido: la misma
  // persona anotada dos veces en la planilla de la feria sigue siendo un dato
  // que el ADMIN puso ahí. El externalId incluye el número de fila justamente
  // para que no colapsen — insertPendingEventsBatch afirma esto en un
  // comentario, y sin este test la afirmación solo estaba probada sobre el hash
  // (unit de spreadsheet), nunca contra el índice único real de la tabla.
  assert.equal(body.filasLeidas, 3);
  assert.equal(body.insertados, 3);
  assert.equal(body.duplicados, 0);

  const eventos = await prisma.ingestionEvent.findMany({
    where: { organizationId: orgId, batchId: body.batchId },
    select: { externalId: true },
  });
  assert.equal(eventos.length, 3);
  assert.equal(
    new Set(eventos.map((e) => e.externalId)).size,
    3,
    "los tres externalId tienen que ser distintos o el ON CONFLICT se come una fila",
  );
});

test("un XLSX real se parsea igual que un CSV", async () => {
  const source = await crearSource("Excel", "FILE_IMPORT");

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Apellido", "Mail"]);
  hoja.addRow(["Ana", "Gómez", "ana-xlsx@ejemplo.test"]);
  hoja.addRow(["Beto", "Pérez", "beto-xlsx@ejemplo.test"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const res = await subir(admin.accessToken, source, "feria.xlsx", buffer);
  assert.equal(res.status, 202);

  const body = (await res.json()) as { batchId: string; insertados: number };
  assert.equal(body.insertados, 2);

  const eventos = await prisma.ingestionEvent.findMany({
    where: { organizationId: orgId, batchId: body.batchId },
    select: { rawPayload: true },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(eventos[0].rawPayload, {
    Nombre: "Ana",
    Apellido: "Gómez",
    Mail: "ana-xlsx@ejemplo.test",
  });
});

test("no se puede importar contra una fuente WEBHOOK", async () => {
  const res = await subir(admin.accessToken, sourceWebhook, "l.csv", "Nombre\nAna");
  assert.equal(res.status, 400);
});

test("un sourceId inexistente da 404 — y el de otra organización, y el retirado, también", async () => {
  const inexistente = await subir(admin.accessToken, randomUUID(), "l.csv", "Nombre\nAna");
  assert.equal(inexistente.status, 404);

  const otraOrg = await prisma.organization.create({
    data: {
      name: `Import otra org fuente ${randomUUID()}`,
      slug: `import-otra-fuente-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  try {
    const ajena = await prisma.source.create({
      data: { organizationId: otraOrg.id, name: "Ajena", type: "FILE_IMPORT" },
      select: { id: true },
    });

    // La fuente EXISTE y es del tipo correcto, pero es de otra organización:
    // 404, indistinguible del inexistente. Si esto diera 400 ("no es
    // FILE_IMPORT") o 403, confirmaría que el recurso existe — el aislamiento
    // se rompe igual por lo que el error DEJA VER que por lo que deja hacer.
    const res = await subir(admin.accessToken, ajena.id, "l.csv", "Nombre\nAna");
    assert.equal(res.status, 404);

    assert.equal(
      await prisma.ingestionEvent.count({ where: { organizationId: otraOrg.id } }),
      0,
      "no se pudo haber escrito nada en la organización ajena",
    );
  } finally {
    await prisma.ingestionEvent.deleteMany({ where: { organizationId: otraOrg.id } });
    await prisma.source.deleteMany({ where: { organizationId: otraOrg.id } });
    await prisma.organization.deleteMany({ where: { id: otraOrg.id } });
  }

  // findSourceById filtra `deletedAt: null`, así que una fuente retirada
  // tampoco existe para la API. El comentario de import.service.ts afirma las
  // dos cosas; acá se verifican las dos.
  const retirada = await crearSource("Retirada", "FILE_IMPORT");
  await prisma.source.update({
    where: { id: retirada },
    data: { deletedAt: new Date() },
  });

  const resRetirada = await subir(admin.accessToken, retirada, "l.csv", "Nombre\nAna");
  assert.equal(resRetirada.status, 404);
});

test("una fuente PAUSADA (isActive: false) rechaza la importación con 400", async () => {
  const source = await crearSource("Pausada", "FILE_IMPORT");
  await prisma.source.update({ where: { id: source }, data: { isActive: false } });

  // Pausar una integración tiene que pausar TODAS sus puertas de entrada, no
  // solo la automática: si el archivo entrara igual, "pausada" significaría
  // apenas "pausada para el webhook" y el ADMIN que la pausó no lo sabría.
  const res = await subir(admin.accessToken, source, "l.csv", "Nombre,Mail\nAna,ana@ejemplo.test");
  assert.equal(res.status, 400);

  assert.equal(
    await prisma.ingestionEvent.count({ where: { organizationId: orgId, sourceId: source } }),
    0,
    "una fuente pausada no puede dejar filas en staging",
  );

  // Y despausarla la vuelve a habilitar, sin ningún otro paso: el rechazo es
  // por el estado actual, no por algo que quedó marcado en la fuente.
  await prisma.source.update({ where: { id: source }, data: { isActive: true } });
  const despues = await subir(
    admin.accessToken,
    source,
    "l.csv",
    "Nombre,Mail\nAna,ana-pausada@ejemplo.test",
  );
  assert.equal(despues.status, 202);
});

test("una extensión no soportada da 415", async () => {
  const res = await subir(admin.accessToken, sourceFile, "leads.txt", "Nombre\nAna");
  assert.equal(res.status, 415);
});

test("un archivo por encima de IMPORT_MAX_FILE_BYTES da 413, no el 500 que daría sin traducir", async () => {
  // Mismo criterio que el 413 del webhook en ingest.controller.integration-test:
  // el tope se ejercita mandando un cuerpo real que lo supera, no simulando el
  // error de multer. Sin la traducción de importUpload, un MulterError no es un
  // AppError y errorHandler lo mandaría a 500 — un error del servidor por algo
  // que hizo el cliente.
  const gigante = Buffer.alloc(IMPORT_MAX_FILE_BYTES + 1024, "x");

  const res = await subir(admin.accessToken, sourceFile, "gigante.csv", gigante);

  assert.equal(res.status, 413);
});

test('un multipart SIN el campo "file" da 400, no un 500 por req.file undefined', async () => {
  // El handler hace `req.file!`. Ese non-null solo es honesto si el middleware
  // garantiza que existe: si algún día se sacara el chequeo de importUpload,
  // esto pasaría de 400 a un TypeError convertido en 500, y este test es lo
  // único que lo vería.
  const form = new FormData();
  form.append("sourceId", sourceFile);

  const res = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: form,
  });

  assert.equal(res.status, 400);
});

test("el archivo en un campo con OTRO nombre también da 400, no se acepta en silencio", async () => {
  const form = new FormData();
  form.append("sourceId", sourceFile);
  form.append("archivo", new Blob(["Nombre\nAna"]), "l.csv");

  const res = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: form,
  });

  assert.equal(res.status, 400);
});

test("un USER no puede importar: es ADMIN-only, por el camino de auth existente", async () => {
  const res = await subir(usuarioComun.accessToken, sourceFile, "l.csv", "Nombre\nAna");
  assert.equal(res.status, 403);
});

test("sin token no se puede importar ni consultar un lote", async () => {
  const sinToken = await fetch(`${baseUrl}/api/imports`, { method: "POST" });
  assert.equal(sinToken.status, 401);

  const consulta = await fetch(`${baseUrl}/api/imports/${randomUUID()}`);
  assert.equal(consulta.status, 401);
});

// ---------------------------------------------------------------------------
// Promoción vía fieldMapping
// ---------------------------------------------------------------------------

test("una fila con encabezados custom se traduce y promueve igual que el contrato fijo", async () => {
  const source = await crearSource("Con mapeo", "FILE_IMPORT");
  await api("PATCH", `/api/sources/${source}`, admin.accessToken, {
    fieldMapping: {
      "Nombre de pila": "firstName",
      Apellido: "lastName",
      "Correo electrónico": "email",
      Teléfono: "phone",
    },
  });

  const email = `mapeada-${randomUUID()}@ejemplo.test`;
  const csv = [
    "Nombre de pila,Apellido,Correo electrónico,Teléfono,Columna que nadie mapeó",
    `Ana,Gómez,${email},+5411000000,basura`,
  ].join("\n");

  const { batchId } = (await (await subir(admin.accessToken, source, "leads.csv", csv)).json()) as {
    batchId: string;
  };

  const resumen = await drenarPendientes({ organizationId: orgId });
  assert.ok(resumen.procesados >= 1);

  const evento = await prisma.ingestionEvent.findFirstOrThrow({
    where: { organizationId: orgId, batchId },
    select: { status: true, promotedContactId: true, rawPayload: true, errorMessage: true },
  });

  assert.equal(evento.status, "PROCESSED", `no se promovió: ${evento.errorMessage}`);

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: evento.promotedContactId! },
  });
  assert.equal(contacto.firstName, "Ana");
  assert.equal(contacto.lastName, "Gómez");
  assert.equal(contacto.email, email);
  assert.equal(contacto.phone, "+5411000000");
  // Contact.source sigue siendo el nombre de la Source, igual que en el webhook.
  assert.equal(contacto.source, "Con mapeo");
  // La ingesta sigue sin escribir lifecycleStage.
  assert.equal(contacto.lifecycleStage, "LEAD");

  // Y el staging SIGUE crudo después de promover: la traducción no lo reescribe.
  assert.deepEqual(Object.keys(evento.rawPayload as object).sort(), [
    "Apellido",
    "Columna que nadie mapeó",
    "Correo electrónico",
    "Nombre de pila",
    "Teléfono",
  ]);
});

test("un mapeo cuyas columnas no existen en el archivo marca FAILED con un motivo útil", async () => {
  const source = await crearSource("Mapeo que no matchea", "FILE_IMPORT");
  await api("PATCH", `/api/sources/${source}`, admin.accessToken, {
    fieldMapping: { "Nombre con tilde": "firstName", Apelido: "lastName" },
  });

  const { batchId } = (await (
    await subir(admin.accessToken, source, "l.csv", "Nombre,Apellido\nAna,Gómez")
  ).json()) as { batchId: string };

  await drenarPendientes({ organizationId: orgId });

  const evento = await prisma.ingestionEvent.findFirstOrThrow({
    where: { organizationId: orgId, batchId },
    select: { status: true, errorMessage: true, promotedContactId: true },
  });

  assert.equal(evento.status, "FAILED");
  assert.equal(evento.promotedContactId, null);
  // El mensaje tiene que apuntar al MAPEO, no a "firstName es requerido", que
  // mandaría a revisar el archivo cuando el problema está en la configuración.
  assert.match(evento.errorMessage ?? "", /fieldMapping/);
});

test("una fila que después de traducida no cumple el contrato falla, y el resto del lote sigue", async () => {
  const source = await crearSource("Lote mixto", "FILE_IMPORT");
  await api("PATCH", `/api/sources/${source}`, admin.accessToken, {
    fieldMapping: { Nombre: "firstName", Apellido: "lastName", Mail: "email" },
  });

  const buena = `buena-${randomUUID()}@ejemplo.test`;
  const csv = [
    "Nombre,Apellido,Mail",
    // Sin apellido: no alcanza para construir un Contact válido.
    `Ana,,sin-apellido-${randomUUID()}@ejemplo.test`,
    `Beto,Pérez,${buena}`,
    // Email con formato inválido.
    "Caro,Díaz,no-es-un-email",
  ].join("\n");

  const { batchId } = (await (await subir(admin.accessToken, source, "l.csv", csv)).json()) as {
    batchId: string;
  };

  await drenarPendientes({ organizationId: orgId });

  const porEstado = await prisma.ingestionEvent.groupBy({
    by: ["status"],
    where: { organizationId: orgId, batchId },
    _count: { _all: true },
  });
  const contar = (estado: string) => porEstado.find((f) => f.status === estado)?._count._all ?? 0;

  assert.equal(contar("FAILED"), 2, "las dos filas malas se marcan");
  assert.equal(contar("PROCESSED"), 1, "la buena se promueve igual");
  assert.equal(contar("PENDING"), 0, "el drenado no se quedó a mitad");

  assert.equal(await prisma.contact.count({ where: { organizationId: orgId, email: buena } }), 1);
});

test("una fuente FILE_IMPORT SIN mapeo valida el archivo contra el contrato fijo", async () => {
  const source = await crearSource("Sin mapeo", "FILE_IMPORT");
  const email = `directo-${randomUUID()}@ejemplo.test`;

  const { batchId } = (await (
    await subir(admin.accessToken, source, "l.csv", `firstName,lastName,email\nAna,Gómez,${email}`)
  ).json()) as { batchId: string };

  await drenarPendientes({ organizationId: orgId });

  const evento = await prisma.ingestionEvent.findFirstOrThrow({
    where: { organizationId: orgId, batchId },
    select: { status: true, errorMessage: true },
  });
  assert.equal(evento.status, "PROCESSED", `${evento.errorMessage}`);
});

// ---------------------------------------------------------------------------
// El resultado del lote (§5)
// ---------------------------------------------------------------------------

test("GET /api/imports/:batchId cuenta bien ANTES y DESPUÉS de drenar", async () => {
  const source = await crearSource("Resumen", "FILE_IMPORT");
  await api("PATCH", `/api/sources/${source}`, admin.accessToken, {
    fieldMapping: { Nombre: "firstName", Apellido: "lastName", Mail: "email" },
  });

  const csv = [
    "Nombre,Apellido,Mail",
    `Ana,Gómez,r1-${randomUUID()}@ejemplo.test`,
    `Beto,Pérez,r2-${randomUUID()}@ejemplo.test`,
    "Sin,,apellido-invalido",
  ].join("\n");

  const { batchId } = (await (await subir(admin.accessToken, source, "l.csv", csv)).json()) as {
    batchId: string;
  };

  // ANTES de drenar: todo pendiente.
  const antes = (await (await api("GET", `/api/imports/${batchId}`, admin.accessToken)).json()) as {
    total: number;
    pendientes: number;
    promovidos: number;
    fallidos: number;
  };

  assert.equal(antes.total, 3);
  assert.equal(antes.pendientes, 3);
  assert.equal(antes.promovidos, 0);
  assert.equal(antes.fallidos, 0);

  await drenarPendientes({ organizationId: orgId });

  // DESPUÉS: "cuántos entraron, cuántos se promovieron, cuántos fallaron y por
  // qué" — las cuatro cosas que §5 exige, literal.
  const despues = (await (
    await api("GET", `/api/imports/${batchId}`, admin.accessToken)
  ).json()) as {
    total: number;
    pendientes: number;
    promovidos: number;
    fallidos: number;
    fallas: { errorMessage: string; rawPayload: Record<string, unknown> }[];
    fallasOmitidas: number;
  };

  assert.equal(despues.total, 3);
  assert.equal(despues.pendientes, 0);
  assert.equal(despues.promovidos, 2);
  assert.equal(despues.fallidos, 1);

  assert.equal(despues.fallas.length, 1);
  assert.ok(despues.fallas[0].errorMessage, "el por qué no puede venir vacío");
  assert.equal(despues.fallasOmitidas, 0);
  // La fila que falló viene con sus encabezados originales: es lo que permite
  // ver QUÉ fila era sin volver a abrir el archivo.
  assert.equal(despues.fallas[0].rawPayload.Nombre, "Sin");
});

test("un batchId inexistente da 404, y el de otra organización también", async () => {
  const res = await api("GET", `/api/imports/${randomUUID()}`, admin.accessToken);
  assert.equal(res.status, 404);

  const otraOrg = await prisma.organization.create({
    data: {
      name: `Import otra org ${randomUUID()}`,
      slug: `import-otra-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  try {
    const sourceAjena = await prisma.source.create({
      data: { organizationId: otraOrg.id, name: "Ajena", type: "FILE_IMPORT" },
      select: { id: true },
    });
    const batchAjeno = randomUUID();
    await prisma.ingestionEvent.create({
      data: {
        organizationId: otraOrg.id,
        sourceId: sourceAjena.id,
        batchId: batchAjeno,
        externalId: `ajeno-${randomUUID()}`,
        rawPayload: { Nombre: "Ajeno" },
      },
    });

    // El batch EXISTE, pero es de otra organización: 404, indistinguible del
    // inexistente. No se confirma la existencia de recursos ajenos.
    const ajeno = await api("GET", `/api/imports/${batchAjeno}`, admin.accessToken);
    assert.equal(ajeno.status, 404);
  } finally {
    await prisma.ingestionEvent.deleteMany({ where: { organizationId: otraOrg.id } });
    await prisma.source.deleteMany({ where: { organizationId: otraOrg.id } });
    await prisma.organization.deleteMany({ where: { id: otraOrg.id } });
  }
});

test("un USER no puede consultar el resultado de un lote", async () => {
  const res = await api("GET", `/api/imports/${randomUUID()}`, usuarioComun.accessToken);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Vista previa de encabezados — POST /api/imports/preview (Fase 2c).
//
// La garantía que estos tests protegen no es "devuelve encabezados": es que
// devuelve LOS MISMOS que la importación real. Ver previsualizarEncabezados en
// import.service.ts — las dos rutas llaman a la misma cadena
// formatoDesdeNombre -> parsearArchivo, y el test de abajo lo verifica sobre el
// mismo archivo por los dos caminos, no leyendo el código.
// ---------------------------------------------------------------------------

// Sube un archivo a /preview. Sin sourceId a propósito: el endpoint no lo pide.
function previsualizar(
  token: string,
  nombre: string,
  contenido: Buffer | string,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([contenido]), nombre);

  return fetch(`${baseUrl}/api/imports/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

test("preview de un CSV devuelve los encabezados y NO escribe nada", async () => {
  const eventosAntes = await prisma.ingestionEvent.count({ where: { organizationId: orgId } });

  const res = await previsualizar(
    admin.accessToken,
    "leads.csv",
    "Nombre,Apellido,Mail\nAna,Gómez,ana@ejemplo.test\n",
  );
  assert.equal(res.status, 200);

  const body = (await res.json()) as { encabezados: string[] };
  assert.deepEqual(body.encabezados, ["Nombre", "Apellido", "Mail"]);

  // La afirmación central del endpoint: es de solo lectura.
  assert.equal(
    await prisma.ingestionEvent.count({ where: { organizationId: orgId } }),
    eventosAntes,
    "la vista previa no puede crear ningún IngestionEvent",
  );
});

test("preview de un XLSX real también funciona", async () => {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Leads");
  hoja.addRow(["Nombre", "Apellido", "Mail"]);
  hoja.addRow(["Ana", "Gómez", "ana-preview@ejemplo.test"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const res = await previsualizar(admin.accessToken, "feria.xlsx", buffer);
  assert.equal(res.status, 200);

  const body = (await res.json()) as { encabezados: string[] };
  assert.deepEqual(body.encabezados, ["Nombre", "Apellido", "Mail"]);
});

test("EL MISMO ARCHIVO da los MISMOS encabezados por los dos caminos", async () => {
  // Este es el test que justifica la tarea. Si alguien reimplementara el parseo
  // en la vista previa, acá se vería: un BOM, un espacio, una celda con formato
  // alcanzarían para que el mapeo armado mirando el preview no matcheara lo que
  // la importación real interpreta.
  //
  // El contenido es deliberadamente hostil: BOM de Excel al principio, espacios
  // alrededor de los encabezados, una columna sin nombre al final.
  const contenido = "\ufeff Nombre , Apellido ,Mail,\nAna,Gómez,ana-doble@ejemplo.test,\n";
  const source = await crearSource("Doble camino", "FILE_IMPORT");

  const preview = await previsualizar(admin.accessToken, "doble.csv", contenido);
  assert.equal(preview.status, 200);
  const { encabezados: delPreview } = (await preview.json()) as { encabezados: string[] };

  const importacion = await subir(admin.accessToken, source, "doble.csv", contenido);
  assert.equal(importacion.status, 202);
  const { encabezados: deLaImportacion } = (await importacion.json()) as {
    encabezados: string[];
  };

  assert.deepEqual(delPreview, deLaImportacion);
  // Y no es que los dos devuelvan vacío: el BOM se comió, los espacios se
  // recortaron y la columna sin nombre se ignoró, en los dos por igual.
  assert.deepEqual(delPreview, ["Nombre", "Apellido", "Mail"]);
});

test("preview hereda los mismos rechazos que la importación real", async () => {
  // Extensión no soportada: 415, igual que en /imports.
  const extension = await previsualizar(admin.accessToken, "leads.txt", "Nombre\nAna");
  assert.equal(extension.status, 415);

  // Archivo por encima del tope de multer: 413, igual que en /imports.
  const grande = Buffer.alloc(IMPORT_MAX_FILE_BYTES + 1024, 0x61);
  const tamano = await previsualizar(admin.accessToken, "grande.csv", grande);
  assert.equal(tamano.status, 413);

  // Sin el campo "file": 400, igual que en /imports.
  const form = new FormData();
  const sinArchivo = await fetch(`${baseUrl}/api/imports/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: form,
  });
  assert.equal(sinArchivo.status, 400);
});

test("preview hereda el rechazo de un archivo sin filas de datos", async () => {
  // Consecuencia deliberada de reusar parsearArchivo tal cual: un archivo con
  // solo encabezados da 400 en los dos caminos. Relajarlo acá exigiría un
  // segundo camino de parseo, que es justo lo que este endpoint evita.
  const res = await previsualizar(admin.accessToken, "solo-encabezados.csv", "Nombre,Mail\n");
  assert.equal(res.status, 400);
});

test("preview es ADMIN-only y exige token", async () => {
  const deUsuario = await previsualizar(usuarioComun.accessToken, "leads.csv", "Nombre\nAna");
  assert.equal(deUsuario.status, 403);

  const form = new FormData();
  form.append("file", new Blob(["Nombre\nAna"]), "leads.csv");
  const sinToken = await fetch(`${baseUrl}/api/imports/preview`, { method: "POST", body: form });
  assert.equal(sinToken.status, 401);
});
