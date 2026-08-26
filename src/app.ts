import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler";
import { notFound } from "./middlewares/notFound";
import { routes } from "./routes";
import { ingestRouter } from "./routes/ingest.routes";

// Arma la instancia de Express (middlewares + rutas) sin escuchar ningún
// puerto — eso es responsabilidad exclusiva de server.ts.
export const app = express();

app.use(helmet());

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(routes);

app.use(notFound);
app.use(errorHandler);
