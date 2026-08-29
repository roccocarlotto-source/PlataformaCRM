import type { NextFunction, Request, Response } from "express";
import { rateLimit, type RateLimitInfo } from "express-rate-limit";
import type { z } from "zod";
import { env } from "../config/env";
import { acceptInvitationSchema } from "../schemas/invitation.schema";
import { onboardingOtpSchema, onboardingSchema } from "../schemas/onboarding.schema";
import type { AuthContext, InvitationAcceptIdentity } from "../types/auth";
import type { IngestContext } from "../types/ingest";
import { AppError } from "../utils/AppError";

// M1 — rate limiting a nivel Express (docs/project-overview.md §8/§9).
//
// Cada limiter se expone también como función factory (create*RateLimiter)
// además de la instancia singleton que realmente montan las rutas: los
// tests de integración usan las factories para levantar una instancia
// fresca (su propio MemoryStore) por caso, sin heredar el contador
// acumulado de otros tests ni el de las instancias de producción — mismos
// valores, misma lógica, Store aislado.
//
// Ningún limiter recibe nunca un `store` explícito ni comparte una misma
// instancia con otro: cada llamada a rateLimit(...) obtiene su propio
// MemoryStore por defecto (verificado contra la documentación oficial de
// express-rate-limit@8.5.2 — el check `unsharedStore` de la librería
// existe exactamente para detectar el caso contrario, que este diseño
// nunca produce, porque nunca se construye/pasa un `store` manualmente).
//
// Store: MemoryStore (default de la librería) — estado en memoria del
// proceso, se resetea en cada restart/deploy, NO se comparte entre
// múltiples instancias/procesos. Aceptado deliberadamente para la
// topología hoy demostrada de Plataforma CRM (proceso Node único, sin
// evidencia de réplicas — ver docs/project-overview.md). Si la topología
// pasa a múltiples instancias, esta política debe migrar a un store
// compartido (Postgres o un proveedor externo) antes de considerarse
// correcta — no es automático.
//
// trust proxy: deliberadamente sin configurar (default de Express,
// deshabilitado), y la consecuencia es que NINGÚN limiter de este archivo
// puede keyear por IP. Hasta el 28/08 el encabezado decía que el default por
// IP de la librería era "correcto para un proceso Node/Express directo, sin
// reverse proxy documentado delante"; ese día entró el Dockerfile, y un
// contenedor se despliega detrás de un proxy o balanceador —el de cualquier
// PaaS— por definición. Con trust proxy apagado, detrás de un proxy `req.ip`
// es LA IP DEL PROXY PARA TODOS LOS CLIENTES, así que un cupo por IP no es
// "un poco impreciso": es un cupo GLOBAL que cualquiera agota gratis para
// todos los demás (A-2 de docs/auditoria-2026-08-29.md).
//
// Por eso cada limiter keyea por una identidad que el request trae consigo:
// el userId del JWT ya verificado, el apiKeyId de la clave de ingesta, o el
// email del body en los dos endpoints de onboarding (ver
// crearKeyingPorEmail). La única excepción hoy es acceptPreAuthRateLimiter,
// que corre antes de que exista ninguna identidad; ver su comentario.
//
// Ningún keyGenerator de acá confía en X-Forwarded-For más allá de lo que
// Express ya decide via trust proxy. Configurar trust proxy a la topología
// real (nunca `true` a ciegas) sigue siendo un requisito del deploy, pero para
// que `req.ip` y los logs digan la verdad — no para que un limiter dependa de
// él.

// express-rate-limit@8.5.2 no aumenta globalmente Express.Request con
// `rateLimit` (a diferencia de versiones anteriores) — el nombre de la
// propiedad es configurable (`requestPropertyName`, default "rateLimit") y
// la librería expone el tipo `RateLimitInfo` para que el consumidor tipe
// el acceso él mismo.
function buildRateLimitHandler(message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
    const resetTime = info?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : 60;
    res.setHeader("Retry-After", String(retryAfterSeconds));
    next(new AppError(message, 429));
  };
}

// ---------------------------------------------------------------------------
// Keying por EMAIL del body — los dos endpoints de onboarding (A-2).
//
// Son los únicos endpoints públicos del sistema cuyo request trae una
// identidad consigo antes de cualquier verificación: el email que se está
// registrando. No es una identidad PROBADA (eso lo hace el OTP), pero es
// exactamente la unidad que hay que acotar: "cuántas veces se intentó
// registrar ESTA dirección", que es lo que cuesta un email de Supabase y una
// llamada a la Admin API. Y es inmune al proxy: no depende de req.ip.
//
// LO QUE ESTO NO ACOTA, escrito para que no se lea como más de lo que es: un
// atacante que rote emails inventados tiene un cupo nuevo por cada uno. Para
// el paso 1 (/otp) eso sigue costando un email por dirección, que Supabase ya
// limita por su lado (max_frequency por email y su propio límite de envíos);
// para el paso 2 un email inventado nunca tiene un OTP válido y muere en
// verifyOtp. El cupo por IP tampoco frenaba a ese atacante —rota IPs igual de
// gratis— y además dejaba a todos los clientes reales detrás de un proxy
// compartiendo cinco intentos; este keying pierde nada de lo que aquel daba
// y deja de castigar a los legítimos.
//
// EL EMAIL SE PARSEA UNA SOLA VEZ. express-rate-limit@8.5.2 llama primero a
// `skip` y después a `keyGenerator`, con el mismo `request` (verificado en
// dist/index.cjs: `await config.skip(...)` y recién después
// `await config.keyGenerator(...)`). skip() ya parseaba el body con el
// schema para decidir si el request cuenta; ahora además guarda el email en
// un WeakMap por request, y keyGenerator() lo lee de ahí. Un WeakMap y no
// una propiedad en `req`: no hay que ampliar el tipo de Request para un dato
// que solo estos dos callbacks se pasan entre sí, y las entradas mueren con
// el request sin que nadie las limpie.
//
// Normalizado a minúsculas: Supabase trata los emails sin distinguir
// mayúsculas, así que `Juan@x.com` y `juan@x.com` son la misma cuenta y
// tienen que compartir cupo — si no, el cupo se multiplica con solo alternar
// el case. El trim ya lo hace el schema.
// ---------------------------------------------------------------------------
const emailPorRequest = new WeakMap<Request, string>();

function crearKeyingPorEmail<T extends { email: string }>(
  limiterName: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return {
    skip: (req: Request): boolean => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return true;
      }
      emailPorRequest.set(req, parsed.data.email.toLowerCase());
      return false;
    },
    keyGenerator: (req: Request): string => {
      const email = emailPorRequest.get(req);
      if (email === undefined) {
        // No debería poder pasar nunca: la librería llama a skip() antes que a
        // keyGenerator() sobre el mismo request, y skip() solo deja pasar los
        // requests para los que guardó el email. Mismo criterio que los otros
        // keyGenerator de este archivo: fallar ruidoso, nunca caer a req.ip.
        throw new Error(
          `${limiterName}: falta el email parseado por skip() — la librería cambió el orden de sus callbacks`,
        );
      }
      return email;
    },
  };
}

// ---------------------------------------------------------------------------
// Onboarding — POST /api/onboarding (público, sin identidad previa).
//
// Amenaza: creación masiva automatizada de Organization + identidad real de
// Supabase Auth (email_confirm: true, sin el rate limit de envío de email
// que sí protege a Invitation), y costo en la Admin API de Supabase.
// keyGenerator: por el email del body (ver crearKeyingPorEmail arriba), nunca
// por IP.
// Cuenta solo requests con body válido según onboardingSchema: un body
// malformado nunca toca Supabase ni Postgres, así que contarlo no protege
// nada y sí penaliza a un usuario real que se equivoca de formato.
//
// Baseline operacional, no un umbral definitivo — ajustable según
// observabilidad/uso real.
// ---------------------------------------------------------------------------
export const ONBOARDING_WINDOW_MS = 15 * 60 * 1000;
export const ONBOARDING_MAX = 5;

export function createOnboardingRateLimiter() {
  return rateLimit({
    windowMs: ONBOARDING_WINDOW_MS,
    max: ONBOARDING_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...crearKeyingPorEmail("onboardingRateLimiter", onboardingSchema),
    handler: buildRateLimitHandler("Demasiados intentos de registro. Probá de nuevo más tarde."),
  });
}

export const onboardingRateLimiter = createOnboardingRateLimiter();

// ---------------------------------------------------------------------------
// Onboarding, paso 1 — POST /api/onboarding/otp (público, sin identidad previa).
// ALTO-2.
//
// LIMITER PROPIO Y NO EL DE ARRIBA, por una razón mecánica: cada uno decide qué
// cuenta contra su cupo parseando SU schema, y un body de solo { email } nunca
// pasa onboardingSchema — reusar aquel habría hecho que este endpoint saltee el
// límite en el 100% de los requests.
//
// Amenaza propia y más aguda que la del paso 2: este es el ÚNICO endpoint del
// sistema que dispara un email hacia una dirección arbitraria elegida por quien
// llama, sin ninguna identidad previa. Sin límite es un amplificador de correo
// no solicitado con el dominio del proyecto como remitente, y el costo lo paga
// la reputación de envío del proyecto de Supabase, no el atacante.
//
// MISMA VENTANA Y MISMO CUPO QUE EL PASO 2, a propósito: los dos pasos son el
// mismo registro visto en dos requests, y darle al primero un cupo distinto solo
// serviría para que el cuello de botella quede en el paso equivocado. Supabase
// además impone su propio mínimo entre envíos por email (max_frequency), que
// acota el abuso dirigido a UNA dirección; este limiter acota el abuso dirigido
// a MUCHAS direcciones, que es lo que aquel no ve.
//
// keyGenerator: por el email del body, igual que el paso 2 (ver
// crearKeyingPorEmail). Con el keying anterior por IP, "muchas direcciones
// desde un mismo origen" era la frase de arriba; con proxy delante, ese
// "mismo origen" eran todos los clientes juntos. Ahora el cupo acota los
// pedidos de código por dirección —cinco cada quince minutos para el mismo
// email—, que es el abuso que de verdad cuesta (un email por pedido) y que
// se puede acotar sin castigar a nadie más.
//
// Baseline operacional, no un umbral definitivo.
// ---------------------------------------------------------------------------
export const ONBOARDING_OTP_WINDOW_MS = ONBOARDING_WINDOW_MS;
export const ONBOARDING_OTP_MAX = ONBOARDING_MAX;

export function createOnboardingOtpRateLimiter() {
  return rateLimit({
    windowMs: ONBOARDING_OTP_WINDOW_MS,
    max: ONBOARDING_OTP_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...crearKeyingPorEmail("onboardingOtpRateLimiter", onboardingOtpSchema),
    handler: buildRateLimitHandler(
      "Demasiados pedidos de código de verificación. Probá de nuevo más tarde.",
    ),
  });
}

export const onboardingOtpRateLimiter = createOnboardingOtpRateLimiter();

// ---------------------------------------------------------------------------
// Invitation accept — etapa 1: pre-auth, POST /api/invitations/accept,
// montado ANTES de verifyInvitationAcceptIdentity.
//
// Amenaza: actor completamente anónimo (sin ningún JWT válido) inundando
// la ruta con tokens basura/vencidos — cada uno paga el costo real de
// intentar verify (parseo + verificación criptográfica ES256 contra el
// JWKS), sin llegar nunca a tener un `sub`. El limiter por identidad
// (etapa 2) estructuralmente no puede mitigar esto: corre después del
// único punto donde ese costo se paga. Población: cualquiera en internet,
// misma que onboarding — a diferencia de la etapa 2, no está acotada a
// "gente invitada".
//
// Cuenta TODO request que llega, sin skip: cualquier filtro acá
// requeriría verificar primero, anulando el propósito del límite.
//
// keyGenerator: ninguno TODAVÍA — sigue en el default de la librería (IP), y
// es el único limiter de este archivo en esa situación. NO es el criterio de
// los otros públicos (onboarding ya keyea por email): es una DECISIÓN
// PENDIENTE, abierta en la revisión de A-2 (docs/auditoria-2026-08-29.md).
// Lo que hace distinto a este endpoint es que no hay ningún dato de identidad
// antes de verificar el JWT — que es justo lo que este limiter protege de
// verificar de más. Mientras la decisión no esté tomada, vale lo que dice el
// encabezado: detrás de un proxy este cupo es global (20 requests cada 5
// minutos para todos los clientes juntos).
// ---------------------------------------------------------------------------
export const ACCEPT_PRE_AUTH_WINDOW_MS = 5 * 60 * 1000;
export const ACCEPT_PRE_AUTH_MAX = 20;

export function createAcceptPreAuthRateLimiter() {
  return rateLimit({
    windowMs: ACCEPT_PRE_AUTH_WINDOW_MS,
    max: ACCEPT_PRE_AUTH_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: buildRateLimitHandler("Demasiados intentos. Probá de nuevo más tarde."),
  });
}

export const acceptPreAuthRateLimiter = createAcceptPreAuthRateLimiter();

// ---------------------------------------------------------------------------
// Invitation accept — etapa 2: post-auth, montado DESPUÉS de
// verifyInvitationAcceptIdentity.
//
// Amenaza: una identidad Supabase YA verificada (población acotada a gente
// invitada u onboardeada, no "cualquiera en internet") golpeando el
// endpoint repetidamente — carga de Postgres, no de CPU de verificación.
//
// keyGenerator custom por identidad verificada (userId = sub del JWT) —
// nunca usa req.ip, así que la validación de fallback-a-IP de la librería
// (ERR_ERL_KEY_GEN_IPV6, agregada en 8.0.0) no aplica acá en absoluto.
// Cuenta solo requests con identidad válida (estructural: si
// verifyInvitationAcceptIdentity falla, este limiter nunca se ejecuta) Y
// body válido según acceptInvitationSchema (skip), mismo criterio que
// onboarding.
// ---------------------------------------------------------------------------
export const ACCEPT_IDENTITY_WINDOW_MS = 10 * 60 * 1000;
export const ACCEPT_IDENTITY_MAX = 10;

function acceptInvitationKeyGenerator(req: Request): string {
  const identity = req.invitationAcceptIdentity as InvitationAcceptIdentity | undefined;
  if (!identity) {
    // No debería poder pasar nunca: verifyInvitationAcceptIdentity corre
    // antes en la cadena y, si falla, ya cortó el request con su propio
    // 401 sin llegar acá.
    throw new Error(
      "acceptInvitationRateLimiter: falta req.invitationAcceptIdentity — verificá el orden de middlewares en invitation.routes.ts",
    );
  }
  return identity.userId;
}

export function createAcceptInvitationRateLimiter() {
  return rateLimit({
    windowMs: ACCEPT_IDENTITY_WINDOW_MS,
    max: ACCEPT_IDENTITY_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: acceptInvitationKeyGenerator,
    skip: (req) => !acceptInvitationSchema.safeParse(req.body).success,
    handler: buildRateLimitHandler("Demasiados intentos. Probá de nuevo más tarde."),
  });
}

export const acceptInvitationRateLimiter = createAcceptInvitationRateLimiter();

// ---------------------------------------------------------------------------
// R1.9 — escrituras de negocio (POST/PATCH/DELETE de Company, Contact,
// Pipeline, Stage, Opportunity, Activity, User, Invitation).
//
// Amenaza: una identidad ya autenticada (nunca anónima — authorize("ADMIN")
// corre después de este limiter en cada ruta, así que la población está
// acotada a cuentas ADMIN ya autenticadas de una organización) escribiendo
// en bucle, por script o por una cuenta comprometida. A diferencia de los
// limiters de arriba (acciones de baja frecuencia: registrarse, aceptar una
// invitación), acá el uso legítimo normal es de alta frecuencia — un ADMIN
// puede reordenar varias etapas seguidas, cargar contactos en lote, etc. —
// por eso el umbral es deliberadamente generoso: frena un script, no un uso
// intensivo real.
//
// keyGenerator por identidad verificada (req.auth.userId, resuelto por
// `authenticate`, que corre antes en la cadena en cada ruta) — mismo
// criterio que acceptInvitationRateLimiter, nunca req.ip.
//
// Baseline operacional, no un umbral definitivo — ajustable según
// observabilidad/uso real, mismo criterio que el resto de este archivo.
// ---------------------------------------------------------------------------
export const BUSINESS_WRITE_WINDOW_MS = 60 * 1000;
export const BUSINESS_WRITE_MAX = 100;

// Keying por identidad ya verificada (req.auth.userId), compartido por todos
// los limiters que corren después de `authenticate`. Se factorizó al agregar
// el de /imports/preview (S2-3): es LA MISMA amenaza —un ADMIN autenticado
// golpeando un endpoint— así que replicar la función habría sido dos copias
// de una decisión que es una sola. El nombre del limiter se pasa solo para
// que el error diga cuál es el router mal ordenado.
function authUserIdKeyGenerator(limiterName: string) {
  return (req: Request): string => {
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (!auth) {
      // No debería poder pasar nunca: `authenticate` corre antes en la cadena
      // y, si falla, ya cortó el request con su propio 401 sin llegar acá —
      // mismo razonamiento que acceptInvitationKeyGenerator.
      throw new Error(
        `${limiterName}: falta req.auth — verificá el orden de middlewares en el router correspondiente`,
      );
    }
    return auth.userId;
  };
}

const businessWriteKeyGenerator = authUserIdKeyGenerator("businessWriteRateLimiter");

// overrides es solo para tests de integración: permite un `max` chico para
// no tener que disparar 100+ requests reales para probar el bloqueo — ver
// rateLimit.integration-test.ts. La instancia de producción (más abajo) no
// pasa overrides, así que sigue usando los umbrales reales.
export function createBusinessWriteRateLimiter(overrides?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: overrides?.windowMs ?? BUSINESS_WRITE_WINDOW_MS,
    max: overrides?.max ?? BUSINESS_WRITE_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: businessWriteKeyGenerator,
    handler: buildRateLimitHandler("Demasiadas solicitudes. Probá de nuevo en un momento."),
  });
}

export const businessWriteRateLimiter = createBusinessWriteRateLimiter();

// ---------------------------------------------------------------------------
// S2-3 — vista previa de encabezados, POST /api/imports/preview.
//
// POR QUÉ NO ALCANZA LA CUOTA DE NEGOCIO, que es la que compartía hasta acá.
// La importación real paga el parseo caro recién DESPUÉS de tres precondiciones
// baratas que quien llama no controla: findSourceById (404), type !==
// FILE_IMPORT (400) y !isActive (400). El preview no tiene ninguna —no recibe
// sourceId, y esa es su razón de ser (§9.11 de
// docs/ingestion-architecture.md)— así que es el camino MÁS BARATO del sistema
// hacia la operación MÁS CARA: expandir un XLSX en memoria, que es un ZIP y por
// lo tanto no está acotado por el tamaño subido (ver parsearXlsx en
// utils/spreadsheet.ts, y S-5 de docs/review-ingesta-2026-08-27.md, donde ese
// costo ya se aceptó como riesgo conocido).
//
// POR QUÉ 10 Y NO 100. BUSINESS_WRITE_MAX es deliberadamente generoso porque su
// uso legítimo es de alta frecuencia: un ADMIN reordenando etapas o cargando
// contactos en lote. Una vista previa de encabezados no se parece a eso — se
// pide una vez por archivo, mientras alguien arma un fieldMapping mirando la
// pantalla. Un orden de magnitud menos sigue siendo holgado para ese uso y
// recorta en 10x el trabajo que una sola identidad puede forzar.
//
// MISMO keying que la escritura de negocio, y a propósito: la población es
// idéntica (ADMIN autenticado, authorize corre después de este limiter) y la
// unidad que se quiere acotar es la identidad, nunca req.ip — ver el encabezado
// de este archivo sobre trust proxy.
//
// Es una cuota SEPARADA, no una más chica compartida: agotar el preview no
// puede dejar sin cupo a POST /imports, que es la escritura real y la que
// alguien está esperando que funcione.
//
// Baseline operacional, no un umbral definitivo — mismo criterio que el resto
// de este archivo.
// ---------------------------------------------------------------------------
export const IMPORT_PREVIEW_WINDOW_MS = 60 * 1000;
export const IMPORT_PREVIEW_MAX = 10;

// overrides es solo para tests de integración, mismo criterio que las otras dos
// factories. La instancia de producción no los pasa.
export function createImportPreviewRateLimiter(overrides?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: overrides?.windowMs ?? IMPORT_PREVIEW_WINDOW_MS,
    max: overrides?.max ?? IMPORT_PREVIEW_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: authUserIdKeyGenerator("importPreviewRateLimiter"),
    handler: buildRateLimitHandler(
      "Demasiadas vistas previas seguidas. Probá de nuevo en un momento.",
    ),
  });
}

export const importPreviewRateLimiter = createImportPreviewRateLimiter();

// ---------------------------------------------------------------------------
// Ítem 4 — ingesta, POST /api/ingest. §3: "Rate limit propio y más estricto por
// clave, independiente del existente. Un endpoint público es spameable por
// definición."
//
// Amenaza: es el ÚNICO endpoint del sistema sin usuario detrás. Los limiters de
// arriba acotan su población a "gente que se registra", "gente invitada" o
// "ADMINs autenticados"; acá la población es cualquier proceso del mundo que
// tenga una clave — típicamente una landing page de cara a internet, es decir
// un emisor cuyo volumen no controlamos y que puede quedar en loop por un bug
// ajeno, no por mala fe. Cada request cuesta un SELECT indexado + un INSERT en
// la tabla de mayor volumen del esquema.
//
// keyGenerator POR CLAVE (req.ingest.apiKeyId), no por IP y no por
// organización, y la diferencia importa en los dos sentidos:
//   - Por IP sería inútil y dañino: una landing page detrás de un CDN presenta
//     pocas IPs para muchos emisores legítimos, y un atacante rota IPs gratis.
//     Además este proyecto no configura trust proxy a propósito (ver el
//     encabezado de este archivo), así que req.ip no es confiable.
//   - Por organización castigaría cruzado: una fuente rota le comería la cuota
//     a las otras fuentes de la misma organización. La clave es la unidad que
//     el ADMIN puede revocar cuando algo se desmadra, así que es la unidad
//     correcta para contar.
//
// Estructuralmente corre SIEMPRE después de authenticateApiKey —necesita
// apiKeyId, que no existe antes— así que NO protege del flood anónimo, con
// clave inválida. Esa superficie queda expuesta a propósito y acotada: un
// request sin clave válida cuesta un hash SHA-256 y una búsqueda por índice
// único, y muere sin tocar ninguna tabla de negocio ni escribir nada.
//
// STORE: MemoryStore, el default de la librería, igual que los otros cuatro
// limiters. ESTO NO ES UNA CUOTA DISTRIBUIDA:
//
//     Con N instancias del proceso, el límite EFECTIVO es N * INGEST_MAX, no
//     INGEST_MAX. Cada instancia cuenta solo lo que le tocó a ella y ninguna ve
//     lo que contaron las otras. Además el contador se resetea entero en cada
//     restart o deploy.
//
// Aceptable en esta etapa —la topología demostrada hoy es un proceso Node
// único, ver docs/project-overview.md— y escrito acá en el CÓDIGO en vez de
// quedar implícito, porque el día que se agregue una réplica el límite se
// duplica en silencio y nada en el sistema lo va a decir. Migrar a un store
// compartido (Postgres o un proveedor externo) es un requisito de ese día, no
// algo que ocurra solo.
//
// Umbral por variable de entorno, con default explícito en config/env.ts: a
// diferencia de los otros cuatro, este límite lo tensa un emisor externo cuyo
// volumen real no conocemos, así que ajustarlo tiene que poder hacerse sin un
// deploy.
// ---------------------------------------------------------------------------
export const INGEST_WINDOW_MS = env.INGEST_RATE_LIMIT_WINDOW_MS;
export const INGEST_MAX = env.INGEST_RATE_LIMIT_MAX;

function ingestKeyGenerator(req: Request): string {
  const ingest = (req as Request & { ingest?: IngestContext }).ingest;
  if (!ingest) {
    // No debería poder pasar nunca: authenticateApiKey corre antes en la cadena
    // y, si falla, ya cortó el request con su 401 sin llegar acá — mismo
    // razonamiento que los dos keyGenerator de arriba.
    throw new Error(
      "ingestRateLimiter: falta req.ingest — verificá el orden de middlewares en ingest.routes.ts",
    );
  }
  return ingest.apiKeyId;
}

// overrides es solo para tests de integración, mismo criterio que
// createBusinessWriteRateLimiter: permite un max chico para no tener que
// disparar cientos de requests reales. La instancia de producción no los pasa.
export function createIngestRateLimiter(overrides?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: overrides?.windowMs ?? INGEST_WINDOW_MS,
    max: overrides?.max ?? INGEST_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: ingestKeyGenerator,
    // Retry-After lo pone buildRateLimitHandler a partir de resetTime. El
    // mensaje no dice cuál es el límite ni cuánta cuota queda: eso ya viaja en
    // los headers estándar, y repetirlo en el cuerpo de un endpoint público es
    // regalar información de configuración.
    handler: buildRateLimitHandler(
      "Demasiadas solicitudes de ingesta. Probá de nuevo en un momento.",
    ),
  });
}

export const ingestRateLimiter = createIngestRateLimiter();
