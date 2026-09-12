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
import { publicWidgetRouter } from "./routes/publicWidget.routes";
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

// pinoHttp ANTES de los parsers de cuerpo (ítem 4) Y, desde el paso 5b del
// módulo de Agentes de IA, TAMBIÉN ANTES DEL cors() GLOBAL. Engancha res.end
// al pasar, así que solo loguea lo que se monta después de él: con el orden
// anterior —parsers primero— un request que moría en el parser (cuerpo
// demasiado grande, JSON inválido) no dejaba NINGUNA línea de log.
//
// EFECTO COLATERAL GLOBAL DE SUBIRLO POR ENCIMA DEL cors() GLOBAL, escrito
// para que no parezca un cambio no intencional: hasta este cambio, CUALQUIER
// preflight OPTIONS de la app entera moría en el cors() global antes de llegar
// a pinoHttp, así que ningún preflight se logueaba nunca, de ningún endpoint.
// Ahora se loguean todos — no solo los de la ruta pública nueva. Es una mejora
// incidental (más visibilidad), no un requisito de este PR; el motivo real de
// moverlo es el de abajo: la ruta pública del widget se monta antes del cors()
// global, y tiene que quedar cubierta por el log igual que la ingesta.
app.use(pinoHttp({ logger }));

// EL ROUTER PÚBLICO DEL WIDGET VA ANTES DEL cors() GLOBAL, Y NO ES COSMÉTICO —
// es el mismo motivo estructural por el que ingestRouter y qrWebhookRouter van
// antes del express.json() global (ver más abajo), aplicado a CORS en vez de
// al parseo del cuerpo: un middleware montado DESPUÉS no puede actuar sobre
// algo que uno anterior ya resolvió o terminó.
//
// El cors() global, montado con app.use() sin filtro de ruta, atiende y
// TERMINA cualquier preflight OPTIONS de la app (responde 204 y no llama a
// next). Un cors() propio montado después de él sobre /api/public nunca vería
// el preflight del widget: el global ya habría contestado con SU lista
// estática de orígenes (CORS_ORIGIN, el frontend propio) y con
// credentials: true — y el widget vive en el sitio de CADA cliente, con un
// origen distinto por agente (Agent.allowedOrigins) y sin cookies. Por eso el
// router público trae su propio CORS dinámico (middlewares/widgetCors.ts),
// resuelto por el :agentId de la URL, y se monta ACÁ, antes del global.
//
// Trae también su propio parser de cuerpo con su propio tope (8 KB,
// middlewares/widgetBody.ts) y su propio camino de autenticación (el embed
// token, middlewares/authenticateEmbedToken.ts), así que además cumple el
// requisito de ir antes del express.json() global por el mismo motivo que la
// ingesta. Ver routes/publicWidget.routes.ts para el orden interno de la
// cadena y docs/ai-agent-architecture.md (nota del paso 5b bajo §6) para el
// diseño.
app.use("/api/public", publicWidgetRouter);

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
//
// maxAge (docs/frontend-cambios-pendientes.md §16 Parte B): sin él la
// respuesta al preflight no lleva Access-Control-Max-Age y el navegador manda
// un OPTIONS nuevo antes de CADA request mutante, aunque repita el mismo
// origen/método/headers segundos después. 600 s (10 minutos) es el valor
// conservador de siempre. No cambia la política: mismos orígenes, mismas
// credenciales — solo por cuánto tiempo el navegador puede recordar la
// decisión.
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    maxAge: 600,
  }),
);
app.use(compression());

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
