import cors, { type CorsOptions, type CorsOptionsDelegate } from "cors";
import type { Request } from "express";
import { findAgentOriginsById } from "../repositories/agent.repository";
import { normalizeOrigin } from "../utils/origin";

// ---------------------------------------------------------------------------
// CORS dinámico por agente para la ruta pública del widget (paso 5b, nota
// fechada bajo §6, punto 2).
//
// El cors() global de app.ts es estático: una lista fija de orígenes
// (CORS_ORIGIN) para el frontend propio. El widget vive en el sitio de CADA
// cliente, así que el origen permitido depende de QUÉ agente se está llamando
// — y eso solo se sabe por el :agentId de la URL, porque el preflight OPTIONS
// nunca trae el valor del header x-embed-token (punto 1 de la nota). De ahí
// el "options delegate" de la librería cors: una función que recibe el
// request y decide las opciones para ese request.
//
// ESTE MIDDLEWARE SE MONTA ANTES DEL cors() GLOBAL (app.ts), y no es
// negociable: el global, montado con app.use() sin filtro de ruta, termina
// cualquier preflight OPTIONS de la app antes de que llegue a otro middleware.
// Montado después, este delegate nunca correría para el preflight.
//
// UUID_RE en vez de Zod: acá no hay que producir un 400 con mensaje —eso lo
// hace el handler más adelante— solo decidir que un agentId que no es UUID no
// refleja ningún origen, sin consultar la base.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Sin ningún origen reflejado: la LISTA VACÍA, y no `origin: false`, y la
// diferencia no es cosmética. Con `origin: false` la librería se saltea el
// request entero (llama a next() sin tocar nada) y el preflight cae en el
// OPTIONS automático de Express, que responde 200 con "Allow: POST" — y en el
// cors() global de app.ts si el router no lo atendiera. Con una lista vacía
// la librería sí atiende el preflight: no matchea ningún origen, no pone
// Access-Control-Allow-Origin, y termina con 204 y Content-Length 0. Eso es
// exactamente "no": el navegador bloquea el request real, y ningún otro
// middleware llega a opinar. No se tira error acá — un agentId inexistente o
// mal formado lo rechaza la cadena real del POST (401 genérico o 400), y
// hacerlo desde el preflight sería otra forma de oráculo.
const SIN_ORIGEN: CorsOptions = {
  origin: [],
  methods: ["POST"],
  allowedHeaders: ["Content-Type", "x-embed-token"],
  maxAge: 600,
  credentials: false,
};

function opcionesPermitidas(): CorsOptions {
  return {
    // `true` REFLEJA el Origin del request en Access-Control-Allow-Origin. Se
    // usa solo después de haberlo comparado contra allowedOrigins: reflejar
    // sin comparar sería CORS abierto.
    origin: true,
    methods: ["POST"],
    allowedHeaders: ["Content-Type", "x-embed-token"],
    // Mismo maxAge que el cors() global: el navegador recuerda la decisión
    // del preflight 10 minutos en vez de mandar un OPTIONS por mensaje.
    maxAge: 600,
    // SIN credenciales, explícito y a propósito: el widget no usa cookies —la
    // identidad viaja en el header del token— así que no hace falta
    // Access-Control-Allow-Credentials, y no mandarlo evita que un navegador
    // adjunte cookies de una sesión del CRM a un request del widget.
    credentials: false,
  };
}

export function buildWidgetCorsMiddleware() {
  const delegate: CorsOptionsDelegate<Request> = (req, callback) => {
    // Express popula req.params para un middleware montado con
    // router.use(path, fn) cuando el path lleva un parámetro con nombre
    // (comportamiento estándar de Express 4/5; el test de integración de la
    // ruta lo ejercita de verdad con un preflight).
    const agentId = String(req.params.agentId ?? "");
    if (!UUID_RE.test(agentId)) {
      callback(null, SIN_ORIGEN);
      return;
    }

    const origin = normalizeOrigin(req.header("Origin") ?? "");
    if (origin === null) {
      callback(null, SIN_ORIGEN);
      return;
    }

    findAgentOriginsById(agentId).then(
      (agent) => {
        // Sin agente, o con allowedOrigins vacío (widget deshabilitado,
        // fail-closed — 5a): nada reflejado. Comparación EXACTA de strings:
        // los dos lados pasaron por normalizeOrigin.
        if (!agent || !agent.allowedOrigins.includes(origin)) {
          callback(null, SIN_ORIGEN);
          return;
        }
        callback(null, opcionesPermitidas());
      },
      // Si la base falla, el error se propaga por la cadena normal (cors lo
      // pasa a next(err)) y errorHandler lo registra como 500.
      (err: unknown) => callback(err as Error, SIN_ORIGEN),
    );
  };

  return cors(delegate);
}
