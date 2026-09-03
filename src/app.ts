import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { jsonParser } from "./middlewares/bodyParserError";
import { errorHandler } from "./middlewares/errorHandler";
import { notFound } from "./middlewares/notFound";
import { routes } from "./routes";
import { ingestRouter } from "./routes/ingest.routes";
import { qrWebhookRouter } from "./routes/qrWebhook.routes";

// Arma la instancia de Express (middlewares + rutas) sin escuchar ningún
// puerto — eso es responsabilidad exclusiva de server.ts.
export const app = express();

app.use(helmet());

// Cache-Control: no-store en TODA la API — hallazgo S2-6 de
// docs/review-fase2-2026-08-28.md.
//
// EN TODA LA API Y NO EN UNA LISTA DE ENDPOINTS, que es la decisión: una lista
// de rutas "con datos personales" es algo que alguien tiene que acordarse de
// actualizar cada vez que se agrega un endpoint, y el día que se olvide nada lo
// va a decir. La regla amplia no tiene ese modo de fallo. El costo es nulo:
// esta API no tiene ninguna respuesta que valga la pena cachear —no hay
// contenido estático, y todo lo demás es específico de un tenant y de un
// momento— así que no se está renunciando a nada real.
//
// TEMPRANO, junto a helmet() y antes de cualquier router: así cubre TODO camino
// de respuesta, incluidos /api/ingest (que se monta antes del express.json()
// global), el 404 de notFound y las respuestas de error de errorHandler. Un
// middleware montado después de las rutas no vería nada de eso.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// LA POLÍTICA CORS DE /api/ingest ES UNA DECISIÓN PENDIENTE, NO UN OLVIDO.
//
// La ingesta hereda esta política global restrictiva —solo los orígenes de
// CORS_ORIGIN— y eso queda así a propósito hasta saber quién es el llamador
// real. Si el webhook lo dispara JavaScript de navegador desde la landing page,
// esta lista tiene que incluir su dominio o el preflight lo va a bloquear; si
// es server-to-server, CORS no interviene en absoluto y la política actual es
// la correcta sin tocar nada.
//
// Abrir el origen antes de saberlo sería relajar una restricción por las dudas,
// y encima expondría la clave de ingesta a vivir en JavaScript de cara al
// público, que es un problema bastante peor que un preflight fallado.
// Documentado en §9.7 de docs/ingestion-architecture.md.
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  }),
);
app.use(compression());

// pinoHttp ANTES de los parsers de cuerpo (ítem 4). Engancha res.end al pasar,
// así que solo loguea lo que se monta después de él: con el orden anterior
// —parsers primero— un request que moría en el parser (cuerpo demasiado grande,
// JSON inválido) no dejaba NINGUNA línea de log. Se registraba el error en
// errorHandler, sin método, sin ruta y sin correlación con un request.
app.use(pinoHttp({ logger }));

// EL ROUTER DE INGESTA VA ANTES DEL express.json() GLOBAL, Y NO ES COSMÉTICO.
//
// body-parser marca el request al parsearlo (req._body) y cualquier instancia
// posterior se saltea a sí misma porque el stream ya se consumió. Montado
// después del parser global, el express.json({ limit }) propio de la ingesta
// nunca correría: el límite efectivo seguiría siendo el default global de
// 100 KB, y el `limit` del router sería una garantía escrita que no garantiza
// nada. Lo mismo vale para su 415: el parser global ya habría dejado un
// req.body vacío en vez de rechazar el Content-Type.
//
// Puesto acá, la ingesta trae su propio parser con su propio tope
// (INGEST_MAX_BODY_BYTES, más estricto que el del resto de la app porque es el
// único endpoint sin usuario detrás) y traduce los errores de body-parser a
// 413/400/415 en vez del 500 que produciría errorHandler. Ver
// middlewares/ingestBody.ts.
//
// Queda después de pinoHttp para que los requests de ingesta SÍ se loguen: el
// test de que la clave no aparece en la línea de log necesita que esa línea
// exista.
app.use("/api", ingestRouter);

// EL WEBHOOK DE MERCADOPAGO VA ACÁ POR EL MISMO MOTIVO EXACTO que ingestRouter
// (docs/qr-integration.md, Fase 2): su cadena verifica la firma HMAC sobre
// headers + query ANTES de leer el cuerpo, y recién después trae su propio
// express.json() con su propio tope. Montado después del parser global, ese
// orden no existiría: el stream ya estaría consumido, el tope propio no
// limitaría nada, y un Content-Type que no fuera JSON pasaría como body vacío
// en vez de rechazarse. Ver routes/qrWebhook.routes.ts.
//
// SIN /api: no es JSON de negocio de un cliente nuestro, lo llama MercadoPago
// — misma excepción de prefijo que las rutas públicas de resolución de QR.
app.use(qrWebhookRouter);

// El mismo express.json() de siempre, con los mismos límites por default,
// pero con sus errores traducidos a 413/400/415 en vez del 500 que producía
// errorHandler (M-11 a). Ver middlewares/bodyParserError.ts.
//
// SIN express.urlencoded(): ningún endpoint de la app consume ese
// content-type (B-23 de docs/auditoria-2026-08-29.md) — montarlo era correr
// qs (extended: true) en cada request para un body que nadie leía. La única
// vía multipart es multer en importRouter, y la ingesta trae su propio
// parser JSON (arriba). Un application/x-www-form-urlencoded sigue sin
// aceptarse, igual que antes, solo que ahora sin parsearlo de por medio.
app.use(jsonParser);

app.use(routes);

app.use(notFound);
app.use(errorHandler);
