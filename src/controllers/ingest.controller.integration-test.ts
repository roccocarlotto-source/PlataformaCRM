import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { loggerOptions } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { authenticateApiKey } from "../middlewares/authenticateApiKey";
import { errorHandler } from "../middlewares/errorHandler";
import {
  INGEST_MAX_BODY_BYTES,
  ingestJsonParser,
  requireJsonContentType,
} from "../middlewares/ingestBody";
import { notFound } from "../middlewares/notFound";
import { createIngestRateLimiter } from "../middlewares/rateLimit";
import { insertPendingIngestionEvent } from "../repositories/ingestionEvent.repository";
import { LAST_USED_AT_GRANULARITY_MS } from "../services/ingestAuth.service";
import { generateApiKey } from "../utils/apiKey";
import { deriveExternalId } from "../utils/externalId";
import { ingestHandler } from "./ingest.controller";

// ---------------------------------------------------------------------------
// Test de integración de la mitad de staging de la ingesta (ítem 4 de
// docs/ingestion-architecture.md §6). HTTP real contra una app Express real,
// con los middlewares reales, contra Postgres real. Sin mocks.
//
// ESTE ARCHIVO LE PREGUNTA A LA BASE, NO AL SERVICE. Es una respuesta directa a
// que tres veces la suite terminó confirmando la implementación en vez de
// verificar el contrato (M-28, el fixture cross-tenant de invitations, las 9
// filas vacías de verify-schema). En concreto:
//
//   - "una sola fila" se cuenta con prisma.ingestionEvent.count, no contando
//     llamadas ni mirando lo que devolvió el service.
//   - "el payload quedó tal cual" se lee de vuelta DE LA COLUMNA, no del objeto
//     que se mandó.
//   - "la base rechaza el cruce de organizaciones" se prueba INTENTANDO el
//     INSERT prohibido y comprobando que la constraint lo tira — no leyendo el
//     WHERE del repositorio.
//   - "no se creó ningún Contact" se cuenta en la tabla contacts.
//   - "la clave no aparece en el log" se verifica sobre la línea que emitió
//     pino de verdad, no sobre la config de redact.
//
// No hace falta ninguna identidad de Supabase Auth en todo el archivo, y eso ya
// es una afirmación sobre el diseño: la ingesta es un camino de autenticación
// que no toca usuarios.
// ---------------------------------------------------------------------------

interface Fixture {
  orgA: string;
  orgB: string;
  sourceA: string;
  sourceB: string;
  claveA: string;
  apiKeyIdA: string;
  claveRevocada: string;
  claveFuentePausada: string;
  claveFuenteRetirada: string;
}

let fx: Fixture;
let baseUrl: string;
let closeApp: () => Promise<void>;
let lineas: string[] = [];
let esperarLinea: () => Promise<string>;

// Una clave con la forma correcta (crm_ + 43 caracteres base64url) que NUNCA se
// insertó. Se genera con el generador real para que el caso "inexistente" no
// sea distinguible por su forma, que es justo lo que el 401 genérico promete.
const CLAVE_INEXISTENTE = generateApiKey().key;

// Monta exactamente la cadena de app.ts para la ingesta, incluido pinoHttp
// ANTES del router: sin eso no habría línea de log que inspeccionar, que es lo
// que el test obligatorio de la clave necesita mirar.
function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  lineas = [];
  let pendiente: ((linea: string) => void) | undefined;

  const sink = new Writable({
    write(chunk, _encoding, callback) {
      const linea = chunk.toString();
      lineas.push(linea);
      pendiente?.(linea);
      pendiente = undefined;
      callback();
    },
  });

  // loggerOptions REAL —el mismo objeto con el que se construye el logger de
  // producción— y solo `transport` pisado para poder capturar a un stream,
  // mismo criterio que logger.test.ts. Si el ensamblado real de `redact` se
  // rompiera, este test lo ve.
  const logger = pino(
    { ...loggerOptions, level: "info", transport: undefined },
    sink,
  );

  // pino-http escribe al terminar la respuesta, que puede ocurrir después de
  // que fetch ya resolvió. Sin esta espera el test miraría un array vacío y
  // pasaría sin haber verificado nada — exactamente el modo de falla que este
  // archivo existe para no repetir.
  esperarLinea = () =>
    new Promise<string>((resolve, reject) => {
      if (lineas.length > 0) {
        resolve(lineas[lineas.length - 1]);
        return;
      }
      const timeout = setTimeout(
        () => reject(new Error("pino no emitió ninguna línea para el request")),
        5000,
      );
      pendiente = (linea) => {
        clearTimeout(timeout);
        resolve(linea);
      };
    });

  const app = express();
  app.use(pinoHttp({ logger }));
  app.post(
    "/api/ingest",
    requireJsonContentType,
    ingestJsonParser,
    authenticateApiKey,
    ingestHandler,
  );
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

async function crearOrganizacion(label: string) {
  const org = await prisma.organization.create({
    data: {
      name: `Ingest test org ${label} ${randomUUID()}`,
      slug: `ingest-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

// Usa el generador REAL y guarda solo el hash, igual que apiKey.service.ts.
// Nada de claves inventadas a mano: si la generación y el hasheo divergieran,
// este fixture lo sufriría antes que producción.
async function crearClave(
  organizationId: string,
  sourceId: string,
  revocada = false,
) {
  const generada = generateApiKey();
  const fila = await prisma.apiKey.create({
    data: {
      organizationId,
      sourceId,
      keyHash: generada.keyHash,
      keyPrefix: generada.keyPrefix,
      ...(revocada ? { revokedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return { clave: generada.key, apiKeyId: fila.id };
}

function ingest(
  clave: string | undefined,
  body: unknown,
  extra?: { externalId?: string; contentType?: string | null; raw?: string },
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (extra?.contentType !== null) {
    headers["content-type"] = extra?.contentType ?? "application/json";
  }
  if (clave !== undefined) {
    headers["x-api-key"] = clave;
  }
  if (extra?.externalId !== undefined) {
    headers["x-external-id"] = extra.externalId;
  }

  return fetch(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers,
    body: extra?.raw ?? JSON.stringify(body),
  });
}

function eventosDe(sourceId: string, externalId: string) {
  return prisma.ingestionEvent.count({ where: { sourceId, externalId } });
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const orgA = await crearOrganizacion("a");
  const orgB = await crearOrganizacion("b");

  const sourceA = await prisma.source.create({
    data: { organizationId: orgA, name: "Landing A", type: "WEBHOOK" },
  });
  const sourceB = await prisma.source.create({
    data: { organizationId: orgB, name: "Landing B", type: "WEBHOOK" },
  });
  const pausada = await prisma.source.create({
    data: {
      organizationId: orgA,
      name: "Pausada",
      type: "WEBHOOK",
      isActive: false,
    },
  });
  const retirada = await prisma.source.create({
    data: {
      organizationId: orgA,
      name: "Retirada",
      type: "WEBHOOK",
      deletedAt: new Date(),
    },
  });

  const activaA = await crearClave(orgA, sourceA.id);
  const revocada = await crearClave(orgA, sourceA.id, true);
  const dePausada = await crearClave(orgA, pausada.id);
  // Deliberadamente SIN revocar, aunque deleteSource revoque en cascada (nota
  // 9.4): este fixture aísla el chequeo de deletedAt del middleware para probar
  // que la defensa en profundidad existe de verdad, y no que la tapa la
  // cascada.
  const deRetirada = await crearClave(orgA, retirada.id);

  fx = {
    orgA,
    orgB,
    sourceA: sourceA.id,
    sourceB: sourceB.id,
    claveA: activaA.clave,
    apiKeyIdA: activaA.apiKeyId,
    claveRevocada: revocada.clave,
    claveFuentePausada: dePausada.clave,
    claveFuenteRetirada: deRetirada.clave,
  };
});

after(async () => {
  if (closeApp) await closeApp();
  if (!fx) return;

  const ambas = { in: [fx.orgA, fx.orgB] };
  // Orden obligado por las FKs: ingestion_events -> sources es RESTRICT.
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: ambas } });
  await prisma.apiKey.deleteMany({ where: { organizationId: ambas } });
  await prisma.source.deleteMany({ where: { organizationId: ambas } });
  await prisma.organization.deleteMany({ where: { id: ambas } });
});

// ---------------------------------------------------------------------------
// Aislamiento multi-tenant — el invariante central del proyecto
// ---------------------------------------------------------------------------

// La primera mitad: por HTTP el cruce NI SIQUIERA SE PUEDE EXPRESAR, porque la
// organización y la Source salen de la clave y no del request. Se afirma sobre
// la fila escrita, leída de la base.
test("una clave de A escribe SIEMPRE contra su propia organización y su propia Source", async () => {
  const externalId = `iso-http-${randomUUID()}`;
  const res = await ingest(fx.claveA, { email: "a@b.com" }, { externalId });
  assert.equal(res.status, 202);

  const { id } = (await res.json()) as { id: string };
  const fila = await prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: { organizationId: true, sourceId: true },
  });

  assert.equal(fila.organizationId, fx.orgA);
  assert.equal(fila.sourceId, fx.sourceA);
  assert.notEqual(fila.sourceId, fx.sourceB);
});

// La segunda mitad, y la que importa: SE INTENTA DE VERDAD el INSERT prohibido,
// saltándose el HTTP y saltándose cualquier validación de la aplicación, para
// comprobar que quien lo rechaza es LA BASE.
//
// Sin este test, "el aislamiento funciona" solo significaría "nuestro código
// hoy no lo intenta". La garantía real es la FK compuesta
// (organization_id, source_id) -> sources(organization_id, id) de C-3, y esto
// es lo único que la comprueba.
test("la BASE rechaza escribir un IngestionEvent de la organización A contra una Source de la B", async () => {
  const externalId = `cross-tenant-${randomUUID()}`;

  let error: unknown;
  try {
    await insertPendingIngestionEvent({
      organizationId: fx.orgA,
      sourceId: fx.sourceB,
      externalId,
      rawPayload: { intento: "cross-tenant" },
    });
  } catch (err) {
    error = err;
  }

  assert.ok(
    error,
    "la base tiene que rechazar el INSERT: si esto pasa, la FK compuesta no está",
  );

  const detalle = `${(error as Error).message} ${JSON.stringify(
    (error as { meta?: unknown }).meta ?? {},
  )}`;
  assert.match(
    detalle,
    /23503|foreign key|ingestion_events_organization_id_source_id_fkey/i,
    `el rechazo tiene que venir de la FK compuesta, no de una validación nuestra. Vino: ${detalle}`,
  );

  assert.equal(
    await eventosDe(fx.sourceB, externalId),
    0,
    "no puede quedar ninguna fila del intento cruzado",
  );
});

// ---------------------------------------------------------------------------
// 401 genérico — nadie puede enumerar claves ni sources
// ---------------------------------------------------------------------------

// El corazón del invariante: los cuatro rechazos son INDISTINGUIBLES desde
// afuera. Se compara el texto crudo, no campo por campo, para que un mensaje
// que se especializara en un refactor lo rompa.
test("clave revocada, inexistente, de fuente pausada y de fuente retirada dan el MISMO 401", async () => {
  const casos: [string, string | undefined][] = [
    ["revocada", fx.claveRevocada],
    ["inexistente", CLAVE_INEXISTENTE],
    ["fuente pausada", fx.claveFuentePausada],
    ["fuente retirada", fx.claveFuenteRetirada],
    ["header ausente", undefined],
    ["header vacío", ""],
  ];

  const respuestas: { caso: string; status: number; texto: string }[] = [];
  for (const [caso, clave] of casos) {
    const res = await ingest(clave, { email: "a@b.com" });
    respuestas.push({ caso, status: res.status, texto: await res.text() });
  }

  const referencia = respuestas[0];
  assert.equal(referencia.status, 401);

  for (const r of respuestas) {
    assert.equal(
      r.status,
      referencia.status,
      `"${r.caso}" respondió ${r.status} y "revocada" respondió ${referencia.status}: la diferencia permite enumerar`,
    );
    assert.equal(
      r.texto,
      referencia.texto,
      `"${r.caso}" respondió un cuerpo distinto al de "revocada": la diferencia permite enumerar`,
    );
  }

  // Y el cuerpo no puede filtrar por qué falló ni nombrar nada del fixture.
  for (const palabra of ["revoc", "pausad", "retirad", "existe", "fuente", "source"]) {
    assert.ok(
      !referencia.texto.toLowerCase().includes(palabra),
      `el 401 no puede insinuar el motivo (contiene "${palabra}"): ${referencia.texto}`,
    );
  }
});

test("un 401 no escribe ningún IngestionEvent", async () => {
  const antes = await prisma.ingestionEvent.count({
    where: { organizationId: { in: [fx.orgA, fx.orgB] } },
  });

  await ingest(CLAVE_INEXISTENTE, { email: "nadie@example.test" });
  await ingest(fx.claveRevocada, { email: "nadie@example.test" });

  assert.equal(
    await prisma.ingestionEvent.count({
      where: { organizationId: { in: [fx.orgA, fx.orgB] } },
    }),
    antes,
  );
});

// La clave se hashea con los BYTES EXACTOS del header. Una clave válida
// alterada de cualquier forma que sobreviva al cable NO es esa clave.
//
// LO QUE ESTE TEST NO PUEDE PROBAR, Y POR QUÉ NO ES UNA OMISIÓN: el caso
// "clave válida con un espacio adelante o atrás" es INEXPRESABLE por HTTP. El
// whitespace que rodea el valor de un header es OWS —opcional por el propio
// protocolo— y lo descarta el parser de Node antes de que exista req.headers,
// así que ` crm_x` y `crm_x` llegan como el MISMO valor y autenticar es lo
// correcto. Ese borde se verifica donde sí existe, sobre la función y sin
// cable: "hashApiKey: no normaliza" en utils/apiKey.test.ts. Es también la
// razón por la que authenticateApiKey no necesita —ni debe— hacer trim.
test("una clave válida alterada NO autentica — el hash es sobre los bytes exactos", async () => {
  const secreto = fx.claveA.slice(4);
  const variantes: [string, string][] = [
    ["capitalización cambiada", `crm_${secreto.toUpperCase()}`],
    ["un espacio en el medio", `crm_${secreto.slice(0, 10)} ${secreto.slice(10)}`],
    ["un caracter de más", `${fx.claveA}x`],
    ["un caracter de menos", fx.claveA.slice(0, -1)],
    ["sin el prefijo crm_", secreto],
  ];

  for (const [caso, variante] of variantes) {
    const res = await ingest(variante, { email: "a@b.com" });
    assert.equal(
      res.status,
      401,
      `"${caso}" no puede autenticar: hashApiKey no normaliza nada`,
    );
  }
});

// ---------------------------------------------------------------------------
// Idempotencia — el único parcial (source_id, external_id)
// ---------------------------------------------------------------------------

test("el mismo X-External-Id dos veces produce UNA sola fila, y el segundo 202 trae el id del primero", async () => {
  const externalId = `idem-${randomUUID()}`;

  const primera = await ingest(fx.claveA, { email: "a@b.com" }, { externalId });
  const segunda = await ingest(
    fx.claveA,
    { email: "OTRO-CONTENIDO@b.com", extra: 1 },
    { externalId },
  );

  assert.equal(primera.status, 202);
  assert.equal(segunda.status, 202, "el reintento no puede recibir un 4xx: entraría en loop");

  const a = (await primera.json()) as { id: string; duplicate: boolean };
  const b = (await segunda.json()) as { id: string; duplicate: boolean };

  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.id, a.id, "el duplicado devuelve el id del evento que YA estaba");

  // LA AFIRMACIÓN QUE IMPORTA: se le pregunta a la tabla, no al service.
  assert.equal(await eventosDe(fx.sourceA, externalId), 1);

  // Y el payload guardado sigue siendo el del PRIMER evento: el duplicado no
  // pisó nada. Es DO NOTHING, no DO UPDATE.
  const fila = await prisma.ingestionEvent.findUniqueOrThrow({
    where: { id: a.id },
    select: { rawPayload: true },
  });
  assert.deepEqual(fila.rawPayload, { email: "a@b.com" });
});

test("sin X-External-Id, el mismo contenido reformateado tampoco duplica (hash canónico)", async () => {
  const marca = randomUUID();
  const externalId = deriveExternalId({ email: "a@b.com", marca });

  const primera = await ingest(fx.claveA, null, {
    raw: JSON.stringify({ email: "a@b.com", marca }),
  });
  // Mismas claves, otro orden y otro espaciado — lo que hace un emisor que
  // reserializa al reintentar.
  const segunda = await ingest(fx.claveA, null, {
    raw: `{\n  "marca": ${JSON.stringify(marca)},\n  "email": "a@b.com"\n}`,
  });

  const a = (await primera.json()) as { id: string; duplicate: boolean };
  const b = (await segunda.json()) as { id: string; duplicate: boolean };

  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.id, a.id);
  assert.equal(await eventosDe(fx.sourceA, externalId), 1);
});

test("dos fuentes distintas pueden usar el MISMO externalId — el único es por Source", async () => {
  const externalId = `compartido-${randomUUID()}`;
  const claveB = (await crearClave(fx.orgB, fx.sourceB)).clave;

  const enA = await ingest(fx.claveA, { de: "A" }, { externalId });
  const enB = await ingest(claveB, { de: "B" }, { externalId });

  assert.equal(enA.status, 202);
  assert.equal(enB.status, 202);
  assert.equal(((await enB.json()) as { duplicate: boolean }).duplicate, false);

  assert.equal(await eventosDe(fx.sourceA, externalId), 1);
  assert.equal(await eventosDe(fx.sourceB, externalId), 1);
});

// ---------------------------------------------------------------------------
// El payload crudo, intacto (§1)
// ---------------------------------------------------------------------------

test("el payload queda guardado TAL CUAL llegó — leído de vuelta de la columna", async () => {
  const externalId = `crudo-${randomUUID()}`;
  const payload = {
    email: "  Ana@EJEMPLO.com  ",
    "campo con espacios": "sí",
    campo_que_no_mapea_a_nada: 42,
    acentos: "ñandú — €",
    vacio: "",
    nulo: null,
    falso: false,
    cero: 0,
    anidado: { utm: { source: "google", medium: null }, tags: ["b", "a"] },
    lista: [1, "dos", { tres: true }],
  };

  const res = await ingest(fx.claveA, payload, { externalId });
  assert.equal(res.status, 202);
  const { id } = (await res.json()) as { id: string };

  const fila = await prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: { rawPayload: true, status: true, errorMessage: true, promotedContactId: true },
  });

  // Sin trim, sin bajar a minúsculas, sin descartar campos desconocidos, sin
  // reordenar arrays. Nada de la normalización que sí hace contact.service
  // ocurre acá: esta capa guarda, no interpreta (§1, y 9.6 sobre dónde vive
  // cada mitad de la normalización de email).
  assert.deepEqual(fila.rawPayload, payload);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.errorMessage, null);
  assert.equal(
    fila.promotedContactId,
    null,
    "la promoción es el ítem 4c: esta etapa no puede tocarla",
  );
});

// ---------------------------------------------------------------------------
// Lo que esta etapa NO puede hacer
// ---------------------------------------------------------------------------

test("después de la ingesta no existe ninguna fila nueva en Contact", async () => {
  const donde = { organizationId: { in: [fx.orgA, fx.orgB] } };
  const antes = await prisma.contact.count({ where: donde });

  // Un payload que parece un contacto listo para promover: si algo en esta capa
  // estuviera promoviendo, este es el caso donde lo haría.
  await ingest(
    fx.claveA,
    { email: `promocion-${randomUUID()}@example.test`, firstName: "Ana", lastName: "Gómez" },
    { externalId: `sin-contacto-${randomUUID()}` },
  );

  assert.equal(
    await prisma.contact.count({ where: donde }),
    antes,
    "la promoción a Contact es el ítem 4c — esta etapa solo escribe staging",
  );
});

// ---------------------------------------------------------------------------
// lastUsedAt
// ---------------------------------------------------------------------------

test("lastUsedAt queda escrito, y con la granularidad decidida no se reescribe en cada request", async () => {
  const clave = await crearClave(fx.orgA, fx.sourceA);

  const inicial = await prisma.apiKey.findUniqueOrThrow({
    where: { id: clave.apiKeyId },
    select: { lastUsedAt: true },
  });
  assert.equal(inicial.lastUsedAt, null, "nace en null");

  const antesDelRequest = Date.now();
  await ingest(clave.clave, { a: 1 }, { externalId: `lastused-${randomUUID()}` });

  const despues = await prisma.apiKey.findUniqueOrThrow({
    where: { id: clave.apiKeyId },
    select: { lastUsedAt: true },
  });
  assert.ok(despues.lastUsedAt !== null, "el request tiene que haber escrito lastUsedAt");
  assert.ok(
    despues.lastUsedAt.getTime() >= antesDelRequest - 1000,
    "lastUsedAt tiene que ser de este request, no un valor viejo",
  );

  // Segundo request inmediato: dentro de la ventana de granularidad, así que la
  // fila NO se vuelve a escribir. Es la mitad que evita un write por request
  // sobre la misma fila.
  await ingest(clave.clave, { a: 2 }, { externalId: `lastused-2-${randomUUID()}` });

  const tercera = await prisma.apiKey.findUniqueOrThrow({
    where: { id: clave.apiKeyId },
    select: { lastUsedAt: true },
  });
  assert.equal(
    tercera.lastUsedAt?.getTime(),
    despues.lastUsedAt.getTime(),
    `dentro de los ${LAST_USED_AT_GRANULARITY_MS} ms de granularidad no debe haber una segunda escritura`,
  );
});

test("una clave rechazada NO registra actividad", async () => {
  const clave = await crearClave(fx.orgA, fx.sourceA, true);

  await ingest(clave.clave, { a: 1 });

  const fila = await prisma.apiKey.findUniqueOrThrow({
    where: { id: clave.apiKeyId },
    select: { lastUsedAt: true },
  });
  assert.equal(
    fila.lastUsedAt,
    null,
    "solo se registra el uso de una credencial ACEPTADA",
  );
});

// ---------------------------------------------------------------------------
// TEST OBLIGATORIO — la clave no aparece en el log
//
// Es el que justifica el invariante de que la clave viaje solo por header:
// `redact` cubre req.headers, no req.url/req.query/req.params. Se verifica
// sobre la línea que pino emitió DE VERDAD, no sobre la configuración.
// ---------------------------------------------------------------------------

test("el valor de la clave NO aparece en la línea de log serializada", async () => {
  lineas = [];
  const res = await ingest(
    fx.claveA,
    { email: "a@b.com" },
    { externalId: `log-${randomUUID()}` },
  );
  assert.equal(res.status, 202);

  const linea = await esperarLinea();

  assert.ok(
    !linea.includes(fx.claveA),
    "la clave en claro NO puede aparecer en ningún lugar de la línea de log",
  );

  // Ni siquiera un fragmento suyo lo bastante largo como para ser útil: el
  // secreto son 43 caracteres base64url después de "crm_".
  const secreto = fx.claveA.slice(4);
  assert.ok(
    !linea.includes(secreto.slice(0, 16)),
    "ningún fragmento del secreto puede aparecer en el log",
  );

  const logueado = JSON.parse(linea) as {
    req: { headers: Record<string, unknown>; url: string };
  };
  assert.equal(
    logueado.req.headers["x-api-key"],
    "[REDACTED]",
    "el header tiene que estar redactado, no ausente por casualidad",
  );

  // Control de que la línea es la del request correcto y que el resto sí se
  // loguea: un test que pasara porque no se logueó nada no probaría nada.
  assert.equal(logueado.req.url, "/api/ingest");
});

test("la URL de ingesta no lleva ningún identificador — no hay nada que redactar ahí", async () => {
  lineas = [];
  await ingest(fx.claveA, { email: "a@b.com" }, { externalId: `url-${randomUUID()}` });

  const logueado = JSON.parse(await esperarLinea()) as { req: { url: string } };

  assert.equal(
    logueado.req.url,
    "/api/ingest",
    "sin query string y sin path param: req.url y req.params se serializan sin redactar (ver logger.test.ts)",
  );
});

// ---------------------------------------------------------------------------
// Content-Type y tamaño del cuerpo
// ---------------------------------------------------------------------------

test("un Content-Type que no sea application/json da 415, y no escribe nada", async () => {
  const antes = await prisma.ingestionEvent.count({
    where: { organizationId: fx.orgA },
  });

  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/xml",
  ]) {
    const res = await ingest(fx.claveA, { email: "a@b.com" }, { contentType });
    assert.equal(res.status, 415, `${contentType} tiene que dar 415`);
  }

  assert.equal(
    await prisma.ingestionEvent.count({ where: { organizationId: fx.orgA } }),
    antes,
  );
});

test("application/json con charset se acepta — es lo que manda cualquier cliente real", async () => {
  const res = await ingest(
    fx.claveA,
    { email: "a@b.com" },
    {
      contentType: "application/json; charset=utf-8",
      externalId: `charset-${randomUUID()}`,
    },
  );
  assert.equal(res.status, 202);
});

test("un cuerpo por encima del límite da 413, no el 500 que daría sin traducir", async () => {
  const gigante = JSON.stringify({
    relleno: "x".repeat(INGEST_MAX_BODY_BYTES + 1024),
  });

  const res = await ingest(fx.claveA, null, { raw: gigante });

  assert.equal(res.status, 413);
});

test("un cuerpo que no es JSON válido da 400", async () => {
  const res = await ingest(fx.claveA, null, { raw: "{no es json" });
  assert.equal(res.status, 400);
});

test("un array da 400 — los lotes son el ítem 5 y todavía no tienen contrato", async () => {
  const res = await ingest(fx.claveA, [{ email: "a@b.com" }], {
    externalId: `array-${randomUUID()}`,
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Rate limit POR CLAVE
// ---------------------------------------------------------------------------

test("el rate limit cuenta por apiKeyId: bloquea con 429 + Retry-After y no afecta a otra clave", async () => {
  const MAX = 2;

  // Instancia propia con su MemoryStore aislado (mismo criterio que
  // rateLimit.integration-test.ts) para no tener que disparar 60 requests
  // reales ni heredar el contador de otros tests.
  const app = express();
  app.post(
    "/api/ingest",
    requireJsonContentType,
    ingestJsonParser,
    authenticateApiKey,
    createIngestRateLimiter({ windowMs: 60_000, max: MAX }),
    ingestHandler,
  );
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/ingest`;

  const post = (clave: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": clave,
        "x-external-id": `rl-${randomUUID()}`,
      },
      body: JSON.stringify({ a: 1 }),
    });

  try {
    const limitada = (await crearClave(fx.orgA, fx.sourceA)).clave;
    const otra = (await crearClave(fx.orgA, fx.sourceA)).clave;

    for (let i = 0; i < MAX; i++) {
      assert.equal((await post(limitada)).status, 202, `el request ${i + 1} debe pasar`);
    }

    const bloqueada = await post(limitada);
    assert.equal(bloqueada.status, 429);
    const retryAfter = bloqueada.headers.get("retry-after");
    assert.ok(retryAfter, "429 tiene que traer Retry-After");
    assert.ok(Number(retryAfter) > 0);

    // La afirmación que prueba que la clave de conteo es apiKeyId y no la
    // organización ni la IP: misma organización, misma Source, misma IP, otra
    // clave — y pasa.
    assert.equal(
      (await post(otra)).status,
      202,
      "otra clave de la MISMA organización y la MISMA IP no puede quedar bloqueada",
    );
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
});
