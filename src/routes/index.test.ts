import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// QUE UN ROUTER EXISTA NO QUIERE DECIR QUE ESTÉ MONTADO, y esa distinción ya
// costó una vez: importRouter estaba escrito, tipado y con su propio test de
// integración en verde, pero nadie lo había agregado a `routes`. En runtime
// /api/imports daba 404 por el notFound genérico. Los tests no lo vieron porque
// cada uno arma su propio express y monta el router a mano —que es lo correcto
// para probar el router, y justamente por eso no puede probar el montaje.
//
// Este archivo prueba lo otro: levanta LA APP REAL, la misma que exporta app.ts
// con su composición completa, y verifica que cada camino de entrada responda
// algo que solo puede venir de SU PROPIA cadena de middlewares. Sin token, una
// ruta montada contesta 401 desde `authenticate`; una ruta que no existe
// contesta 404 desde notFound. Son distinguibles, y de eso se trata.
//
// No toca la base de datos: ninguna de estas respuestas llega a un handler.
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;

before(async () => {
  // LOG_LEVEL antes de importar la app, y por eso el import es dinámico: app.ts
  // arrastra config/env, que se evalúa una sola vez al cargarse. Con el import
  // estático arriba, el nivel ya estaría fijado antes de esta línea y cada
  // request del archivo escupiría su objeto de log completo en la salida del
  // suite unitario, tapando el resultado de los demás tests. dotenv no pisa una
  // variable que ya está en process.env, así que esto gana sin tocar el .env ni
  // la configuración de logging del proyecto.
  //
  // La extensión .js del especificador es obligatoria y no es un error: el
  // paquete es CommonJS, así que un import() dinámico es un import ESM real y
  // con moduleResolution nodenext TypeScript exige la extensión (TS2835).
  // Resuelve a app.ts igual, tanto en tsc como en tsx.
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");

  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

after(async () => {
  if (cerrar) await cerrar();
});

// El caso de control. Sin esto, el archivo entero podría estar afirmando algo
// vacío: si `app` no tuviera notFound, "no da 404" sería trivialmente cierto
// para cualquier ruta, montada o no.
test("CONTROL: una ruta que no existe SÍ da 404 — el 404 de notFound es detectable", async () => {
  const res = await fetch(`${baseUrl}/api/esta-ruta-no-existe`);
  assert.equal(res.status, 404);
});

test("las rutas del ítem 5 están montadas en la app real, no solo en su propio test", async () => {
  // La regresión concreta: sin `routes.use("/api", importRouter)`, las dos
  // daban 404 y ningún test del ítem 5 se enteraba.
  const post = await fetch(`${baseUrl}/api/imports`, { method: "POST" });
  assert.equal(post.status, 401, "POST /api/imports no está montado");

  const get = await fetch(`${baseUrl}/api/imports/${randomUUID()}`);
  assert.equal(get.status, 401, "GET /api/imports/:batchId no está montado");

  // Vista previa de encabezados (Fase 2c), en el mismo router.
  const preview = await fetch(`${baseUrl}/api/imports/preview`, { method: "POST" });
  assert.equal(preview.status, 401, "POST /api/imports/preview no está montado");
});

test("las demás rutas de la capa de ingesta también están montadas", async () => {
  // sourceRouter, apiKeyRouter e ingestionEventRouter van por routes/index.ts,
  // igual que importRouter.
  for (const path of ["/api/sources", "/api/api-keys", "/api/ingestion-events"]) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 401, `${path} no está montado`);
  }

  // El retry es POST y lleva un :id en el path — se verifica aparte porque un
  // GET sobre esa ruta daría 404 aunque el router estuviera bien montado.
  const retry = await fetch(`${baseUrl}/api/ingestion-events/${randomUUID()}/retry`, {
    method: "POST",
  });
  assert.equal(retry.status, 401, "POST /api/ingestion-events/:id/retry no está montado");
});

test("el webhook de ingesta está montado en app.ts, ANTES del express.json() global", async () => {
  // No da 401 sino 415: en /api/ingest el primer middleware de la cadena es
  // requireJsonContentType, no authenticate. Que conteste 415 y no 404 prueba
  // las dos cosas a la vez — que está montado, y que su propia cadena es la que
  // atiende el request en vez del parser global.
  const res = await fetch(`${baseUrl}/api/ingest`, { method: "POST" });
  assert.equal(res.status, 415);
});

// ---------------------------------------------------------------------------
// Módulo QR (docs/qr-integration.md, Fase 2): cuatro caminos de entrada con
// tres cadenas distintas, y cada una responde algo que solo puede venir de su
// propia cadena. Ninguno llega a un handler que toque la base.
// ---------------------------------------------------------------------------

test("las rutas autenticadas del módulo QR están montadas bajo /api", async () => {
  const lista = await fetch(`${baseUrl}/api/qr`);
  assert.equal(lista.status, 401, "GET /api/qr no está montado");

  for (const path of ["/api/qr/claim", "/api/qr/digital"]) {
    const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
    assert.equal(res.status, 401, `POST ${path} no está montado`);
  }

  const patch = await fetch(`${baseUrl}/api/qr/${randomUUID()}`, { method: "PATCH" });
  assert.equal(patch.status, 401, "PATCH /api/qr/:id no está montado");

  const del = await fetch(`${baseUrl}/api/qr/${randomUUID()}`, { method: "DELETE" });
  assert.equal(del.status, 401, "DELETE /api/qr/:id no está montado");

  for (const sufijo of ["qr-subscription-status", "qr-billing-exemption"]) {
    const res = await fetch(`${baseUrl}/api/admin/organizations/${randomUUID()}/${sufijo}`, {
      method: "POST",
    });
    assert.equal(res.status, 401, `POST .../${sufijo} no está montado`);
  }
});

test("la resolución pública de QR está montada SIN /api y sin authenticate", async () => {
  // Sin tocar la base: 404 con la landing HTML (DEC-007), no el 404 JSON de
  // notFound ni un 401. Que la respuesta sea HTML es lo que distingue
  // "montado" de "no montado". Desde Fase 4 ese 404 lo produce
  // requireInternalProxySecret (sin header ni secreto configurado en este
  // entorno, falla cerrado) con la MISMA landing que el controller usa para un
  // id malformado — para este test da igual cuál de los dos contestó: ambos
  // solo existen en la cadena de qrPublicRouter.
  for (const method of ["GET", "POST"]) {
    const res = await fetch(`${baseUrl}/qr/resolve/no-es-un-uuid`, { method });
    assert.equal(res.status, 404, `${method} /qr/resolve/:qrId no está montado`);
    assert.ok(
      res.headers.get("content-type")?.startsWith("text/html"),
      `${method}: respondió la landing HTML, no el notFound genérico`,
    );
  }
});

test("el webhook de MercadoPago está montado en app.ts, ANTES del express.json() global, sin /api", async () => {
  // Sin data.id la cadena corta con 400 desde verifyMercadopagoSignature (o
  // con 500 si el entorno no tiene los secretos de MercadoPago, que es el caso
  // del job unitario del CI). Cualquiera de los dos prueba que el request lo
  // atendió SU cadena y no notFound.
  const res = await fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST" });
  assert.ok([400, 500].includes(res.status), `status inesperado: ${res.status}`);
  assert.notEqual(res.status, 404);
});

test("montar la capa de ingesta no desmontó nada de lo anterior", async () => {
  // Barrido de una ruta por router de negocio. El costo es una llamada HTTP
  // local por línea y evita que el próximo `routes.use` mal puesto tire una
  // ruta existente sin que nadie lo note.
  const rutas = [
    "/api/me",
    "/api/companies",
    "/api/contacts",
    "/api/pipelines",
    "/api/stages",
    "/api/opportunities",
    "/api/activities",
    "/api/invitations",
    "/api/users",
  ];

  for (const path of rutas) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 401, `${path} dejó de estar montada`);
  }
});

// ---------------------------------------------------------------------------
// S2-6 — Cache-Control: no-store en toda la API.
//
// Este archivo es el lugar correcto para probarlo y no un test por ruta: el
// header lo pone un middleware global de app.ts, así que lo que hay que
// verificar es que esté puesto lo bastante temprano como para alcanzar TODO
// camino de respuesta. Eso solo se ve levantando la app real y completa, que es
// exactamente lo que este archivo ya hace.
//
// Los tres casos son caminos distintos de la cadena, no tres veces el mismo:
// una respuesta que sale de un handler real, una que muere en `authenticate`
// (401) y una que muere en `notFound` (404). Un middleware montado después de
// las rutas pasaría el primero y fallaría los otros dos.
//
// SOBRE /health NO SE AFIRMA EL STATUS, y no es dejadez: getHealth consulta la
// base y devuelve 200 o 503 según la alcance, así que vale 200 con una base
// enfrente y 503 en el job unitario de CI, que corre sin ninguna. Lo que este
// caso cubre —una respuesta producida por un handler real, no por un
// middleware que corta antes— es cierto en los dos casos, y pinchar el status
// haría que este test hablara de la salud de la base en vez del header.
// ---------------------------------------------------------------------------

test("S2-6: toda respuesta lleva Cache-Control: no-store, en los tres caminos", async () => {
  const deHandler = await fetch(`${baseUrl}/health`);
  assert.equal(
    deHandler.headers.get("cache-control"),
    "no-store",
    "una respuesta que sale de un handler real tiene que llevar el header",
  );

  const noAutorizado = await fetch(`${baseUrl}/api/contacts`);
  assert.equal(noAutorizado.status, 401);
  assert.equal(
    noAutorizado.headers.get("cache-control"),
    "no-store",
    "una respuesta que muere en authenticate también lleva el header",
  );

  const inexistente = await fetch(`${baseUrl}/api/esta-ruta-no-existe`);
  assert.equal(inexistente.status, 404);
  assert.equal(
    inexistente.headers.get("cache-control"),
    "no-store",
    "el 404 de notFound también lleva el header",
  );
});

// La ingesta se monta ANTES del express.json() global, en su propia rama de
// app.ts. Es el camino que más fácil se saltearía un middleware mal ubicado.
test("S2-6: el camino de ingesta, montado aparte, también lleva el header", async () => {
  const res = await fetch(`${baseUrl}/api/ingest`, { method: "POST" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});
