import { Router } from "express";
import {
  callbackHandler,
  desconectarHandler,
  iniciarConexionHandler,
  obtenerConexionHandler,
} from "../controllers/googleCalendarConnection.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const googleCalendarConnectionRouter = Router();

// ---------------------------------------------------------------------------
// Conexión de una sucursal con Google Calendar (P2.1, paso 2 de §9).
//
// ESTE ROUTER TIENE DOS PERFILES DE AUTENTICACIÓN DISTINTOS EN EL MISMO ARCHIVO,
// que es lo único inusual de acá y está a propósito: las tres rutas bajo
// /branches/:branchId son administrativas y siguen el esquema de siempre
// (authenticate para leer, + authorize("ADMIN") para escribir), y el callback
// NO PUEDE tener ninguna de las dos.
//
// Viven juntas porque son un solo flujo: separarlas en dos archivos escondería
// que el callback es la vuelta de la ruta de arriba, y haría más fácil que
// alguien lo lea como un endpoint suelto sin protección en vez de como el que
// se apoya en el state firmado.
// ---------------------------------------------------------------------------

// Estado de la conexión. Lectura para cualquier usuario autenticado de la
// organización, mismo criterio que el resto de los GET de configuración. Nunca
// devuelve el refresh token — el repositorio usa un `select` que no lo incluye.
googleCalendarConnectionRouter.get(
  "/branches/:branchId/google-calendar",
  authenticate,
  obtenerConexionHandler,
);

// Iniciar la conexión. Devuelve la URL de autorización de Google en el cuerpo;
// no redirige (ver el comentario de iniciarConexion() sobre por qué un 302 no
// funcionaría con un header Authorization).
//
// ES UNA ESCRITURA aunque responda un GET-like: firma un state que habilita a
// escribir en el callback. Por eso lleva ADMIN y el rate limiter, y por eso es
// POST — un GET que produce una credencial sería cacheable y precargable.
//
// businessWriteRateLimiter va DESPUÉS de authenticate (necesita req.auth.userId)
// y ANTES de authorize, mismo orden que branch.routes.ts.
googleCalendarConnectionRouter.post(
  "/branches/:branchId/google-calendar/connect",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  iniciarConexionHandler,
);

// Desconectar: revoca contra Google (best-effort) y deja la fila en REVOKED sin
// token.
googleCalendarConnectionRouter.delete(
  "/branches/:branchId/google-calendar",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  desconectarHandler,
);

// ---------------------------------------------------------------------------
// EL CALLBACK — SIN authenticate Y SIN authorize, Y ESO NO ES UN OLVIDO.
//
// Google redirige el navegador del usuario a esta URL y NO reenvía el header
// Authorization del CRM. No hay JWT que verificar: es estructural del flujo
// OAuth, no una decisión de este proyecto.
//
// LO QUE SOSTIENE LA FRONTERA DE TENANT ACÁ ES EL PARÁMETRO `state`, que es
// firmado y expirable (utils/oauthState.ts) y se valida ANTES de tocar la base.
// El organizationId y el branchId salen del token firmado, nunca de la query
// string. Si esta ruta se copiara a otro flujo sin ese state, sería un endpoint
// público que escribe en la organización que le pidan.
//
// SIN RATE LIMITER, y es una decisión y no un descuido: los limiters del
// proyecto keyean por identidad ya verificada (req.auth.userId, req.ingest
// .apiKeyId) y acá no hay ninguna. Quedaría keyear por IP, que este proyecto
// evita deliberadamente porque no configura trust proxy (ver el encabezado de
// middlewares/rateLimit.ts) — un límite por IP acá sería a la vez evitable
// (rotando IPs) y dañino (varios usuarios detrás de un mismo NAT).
//
// La superficie que eso deja expuesta está acotada por construcción: un request
// sin un `state` con firma válida muere en la verificación, que cuesta un HMAC
// sobre unos cientos de bytes, sin tocar Postgres ni llamar a Google. Es la
// misma forma de razonar que ya se aceptó en /api/ingest para el flood anónimo
// con clave inválida.
//
// LA URL NO LLEVA :branchId. Es deliberado: si la sucursal viniera en el path,
// habría dos fuentes para el mismo dato —el path y el state firmado— y alguien
// terminaría usando la que no está firmada. Una sola fuente, la criptográfica.
// Además esta URL tiene que coincidir EXACTAMENTE con la "Authorized redirect
// URI" cargada en Google Cloud Console, y una fija es una sola entrada ahí en
// vez de una por sucursal (Google no admite comodines en el path).
// ---------------------------------------------------------------------------
googleCalendarConnectionRouter.get("/integrations/google-calendar/callback", callbackHandler);
