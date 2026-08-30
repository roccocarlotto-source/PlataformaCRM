import "dotenv/config";
import { z } from "zod";

// DATABASE_URL, DIRECT_URL y las variables SUPABASE_* quedaron opcionales acá
// a propósito (ver src/lib/*.ts): cada consumidor valida su propia presencia
// en el momento de uso (lib/jwt.ts, lib/supabaseAdmin.ts), así el servidor
// sigue arrancando y /health sigue funcionando aunque falte alguna.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN es requerido"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),

  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Ingesta (docs/ingestion-architecture.md §3) — el único límite de tasa del
  // proyecto que es configurable por entorno, y a propósito: los otros cuatro
  // (rateLimit.ts) acotan acciones cuyo volumen legítimo conocemos —
  // registrarse, aceptar una invitación, escribir como ADMIN. Este lo tensa un
  // emisor externo (una landing page de cara a internet) cuyo tráfico real no
  // controlamos ni podemos estimar de antemano, así que ajustarlo no puede
  // exigir un deploy.
  //
  // El default es explícito, no implícito: 60 eventos por minuto POR CLAVE.
  // Baseline operacional para arrancar, no un umbral definitivo — mismo
  // criterio que el resto de los umbrales del proyecto.
  INGEST_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 1000),
  INGEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  // Worker de ingesta (§5) — in-process, con polling. Arranca en server.ts.
  //
  // No se usa z.coerce.boolean(): coacciona CUALQUIER string no vacío a true,
  // así que INGEST_WORKER_ENABLED=false lo habilitaría. El enum explícito hace
  // imposible ese error.
  INGEST_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((valor) => valor === "true"),
  // 5 segundos: la ingesta es asíncrona por diseño y nadie está esperando del
  // otro lado (el emisor ya recibió su 202), así que la latencia de promoción
  // no es un requisito. Bajarlo multiplica consultas vacías contra la cola sin
  // ganar nada observable.
  INGEST_WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
  // Tope de eventos por pasada, para que una cola grande no monopolice el
  // proceso: se drena un tramo, se cede el control, y el siguiente tick sigue.
  INGEST_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(50),

  // Motor de eventos salientes (outbox) — P1 del roadmap. Mismo patrón que las
  // INGEST_* de arriba: declaradas acá con default explícito y sin aparecer en
  // .env.example, porque ninguna hace falta para arrancar. Se verificó que esa
  // es la convención real (las INGEST_* tampoco están en .env.example) antes de
  // seguirla.
  //
  // Mismo enum explícito que INGEST_WORKER_ENABLED y por el mismo motivo:
  // z.coerce.boolean() coacciona cualquier string no vacío a true, así que
  // OUTBOX_WORKER_ENABLED=false lo habilitaría.
  OUTBOX_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((valor) => valor === "true"),
  // 5 segundos, igual que la ingesta: nadie está esperando del otro lado de un
  // evento saliente, así que la latencia de entrega no es un requisito.
  OUTBOX_WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
  // Tope de eventos por pasada. Más chico que el de ingesta (50) a propósito:
  // ahí cada evento es trabajo de base y termina en milisegundos, acá cada uno
  // puede ser una llamada HTTP a un tercero. Un lote grande de entregas lentas
  // dejaría el tick corriendo minutos.
  OUTBOX_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(20),

  // Reintentos. Al fallar una entrega el evento vuelve a PENDING con
  // nextAttemptAt en el futuro; al alcanzar el tope pasa a DEAD_LETTER, que es
  // terminal y nadie reintenta.
  //
  // 5 intentos con base de 30 s duplicando: 30 s, 1 m, 2 m, 4 m — el último
  // intento cae unas 8 minutos después del primero. Suficiente para atravesar
  // un reinicio o un pico del destino, corto para que un destino realmente roto
  // no acumule reintentos durante horas antes de que alguien lo mire.
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OUTBOX_BACKOFF_BASE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 1000),
  // Techo del backoff. Con 5 intentos y base de 30 s no se alcanza; existe para
  // que subir OUTBOX_MAX_ATTEMPTS no produzca esperas de días por la
  // duplicación.
  OUTBOX_BACKOFF_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),

  // Tope de tiempo para UNA entrega, y no es una comodidad: la entrega corre
  // dentro de la transacción del evento (ver outboxWorker.ts). Sin un tope, un
  // handler colgado sostiene el lock de la fila y una conexión del pool hasta
  // que Prisma aborte la transacción por su propio timeout — y ahí el fallo NO
  // se registra, porque el UPDATE de attempts/nextAttemptAt se revierte con
  // ella. Con este tope el fallo ocurre ADENTRO y queda contabilizado.
  OUTBOX_HANDLER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1000),

  // Tope total del apagado ordenado (M-12 de docs/auditoria-2026-08-29.md):
  // cuánto se espera a que los workers terminen su pasada en curso, el servidor
  // cierre sus conexiones y Prisma se desconecte, antes de forzar la salida con
  // código 1. Ver src/shutdown.ts.
  //
  // TIENE QUE SER MENOR QUE EL GRACE PERIOD DEL ORQUESTADOR —el tiempo entre
  // SIGTERM y SIGKILL—, porque si el orquestador mata el proceso antes, este
  // tope nunca llega a actuar y el apagado ordenado tampoco. Este repo no fija
  // dónde se despliega ni con qué grace period, así que el default es
  // conservador: 8 segundos, por debajo de los 10 s que Docker da por defecto
  // (el más chico de los dos orquestadores habituales; Kubernetes da 30 s),
  // con ~2 s de margen para la latencia de la señal y el $disconnect final.
  // Un apagado normal tarda bien menos de un segundo; lo que este tope corta
  // es una pasada colgada por un motivo que no se anticipó —un handler en su
  // propio tope de OUTBOX_HANDLER_TIMEOUT_MS ya lo excede, y ahí lo correcto
  // es cortar: el evento queda como estaba y se reintenta al reiniciar. Si
  // algún día se sabe el grace period real del entorno, es un ajuste de esta
  // sola constante.
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1000),

  // -------------------------------------------------------------------------
  // Cifrado de secretos en reposo — src/utils/encryption.ts (P2.1, paso 2).
  //
  // Clave maestra de 32 bytes en base64. De ella se derivan por HKDF las
  // subclaves de cada propósito: cifrar secretos recuperables (hoy el refresh
  // token de Google Calendar) y firmar el `state` del flujo OAuth.
  //
  // NO TIENE VALOR TODAVÍA. Se genera con `npm run gen:encryption-key` y se
  // configura en el entorno; sin ella el servidor arranca igual y /health
  // responde, pero cualquier operación de Google Calendar falla con un 500 que
  // dice exactamente qué falta.
  //
  // OPCIONAL ACÁ Y VALIDADA EN EL MOMENTO DE USO, igual que DATABASE_URL y las
  // SUPABASE_*: es la convención real del archivo (ver el comentario de arriba
  // de todo), y el motivo es el mismo — que la falta de una integración no
  // impida arrancar el proceso ni responder el health check.
  //
  // El LARGO no se valida acá sino en parseMasterKey(): un z.string().length()
  // sobre el base64 aceptaría igual cadenas que no decodifican a 32 bytes, así
  // que el chequeo verdadero tiene que mirar los bytes decodificados y ese es el
  // único lugar donde existen.
  SECRET_ENCRYPTION_KEY: z.string().optional(),

  // -------------------------------------------------------------------------
  // Google Calendar OAuth 2.0 — docs/booking-architecture.md §4.
  //
  // NINGUNA TIENE VALOR TODAVÍA: salen de crear un proyecto en Google Cloud
  // Console, habilitar la Google Calendar API y crear credenciales de tipo
  // "OAuth client ID / Web application". Ver docs/bitacora-2026-08-29.md.
  //
  // GOOGLE_REDIRECT_URI tiene que coincidir EXACTAMENTE (esquema, host, puerto y
  // path) con una de las "Authorized redirect URIs" cargadas en esa consola:
  // Google compara la cadena completa y rechaza el intercambio con
  // redirect_uri_mismatch ante cualquier diferencia, incluida una barra final.
  // Apunta al callback de este backend, no al frontend.
  //
  // Opcionales por el mismo criterio que SECRET_ENCRYPTION_KEY y las SUPABASE_*.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // -------------------------------------------------------------------------
  // Sincronización inversa — canales de notificaciones push (P2.1, paso 4).
  //
  // GOOGLE_WEBHOOK_URL: la URL HTTPS que recibe las notificaciones de Google.
  //
  //   NO ALCANZA CON PONERLA ACÁ. Google exige que el DOMINIO esté verificado en
  //   Search Console y registrado como dominio permitido del proyecto en la API
  //   Console — es una medida anti-abuso, para que nadie pueda dirigir
  //   notificaciones al dominio de otro. Sin eso, events.watch falla. Es
  //   configuración externa, igual que las credenciales OAuth del paso 2; ver
  //   docs/bitacora-2026-08-31.md.
  //
  //   Tiene que ser HTTPS con certificado válido (nada de autofirmado), así que
  //   en desarrollo local no funciona sin un túnel público.
  //
  // Opcional por el mismo criterio que el resto de las GOOGLE_*: el servidor
  // arranca sin ella y el worker de canales se apaga solo avisando.
  GOOGLE_WEBHOOK_URL: z.string().optional(),

  // Mismo enum explícito que INGEST_WORKER_ENABLED y por el mismo motivo:
  // z.coerce.boolean() coacciona cualquier string no vacío a true, así que
  // GOOGLE_CHANNEL_WORKER_ENABLED=false lo habilitaría.
  GOOGLE_CHANNEL_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((valor) => valor === "true"),

  // 1 HORA, tres órdenes de magnitud más que los otros dos workers (5 s), y la
  // diferencia es del problema, no de gusto: aquellos drenan colas donde un
  // evento puede llegar en cualquier momento; éste vigila canales que duran
  // SIETE DÍAS. Con un margen de renovación de 24 h, chequear cada hora da 24
  // oportunidades de renovar antes de que el canal venza — de sobra para
  // absorber un deploy o un reinicio.
  GOOGLE_CHANNEL_WORKER_POLL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),

  // Cuánto antes del vencimiento se renueva. 24 horas sobre un canal de 7 días.
  //
  // NO ES UN NÚMERO CÓMODO, ES EL QUE ABSORBE UNA CAÍDA: si el proceso está
  // apagado un fin de semana largo, un margen chico deja vencer los canales y
  // los cambios hechos en Google en esa ventana se pierden para siempre (no hay
  // forma de recuperarlos: el syncToken sigue sirviendo, pero nadie avisa que
  // hay algo que buscar hasta la próxima notificación). Un día de margen cubre
  // un fin de semana de servidor caído sin volver la renovación demasiado
  // agresiva.
  GOOGLE_CHANNEL_RENEW_MARGIN_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),

  // TTL que se le pide a Google al abrir el canal. 604800 s = 7 días, que es el
  // default documentado de la API — verificado contra la referencia de
  // events.watch, no asumido. Se declara explícito para que el valor esté a la
  // vista y no dependa de un default ajeno que puede cambiar.
  GOOGLE_CHANNEL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas o faltantes:\n${issues}`);
  }

  return result.data;
}

const parsed = parseEnv();

export const env = {
  ...parsed,
  LOG_LEVEL: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === "production" ? "info" : "debug"),
  isProduction: parsed.NODE_ENV === "production",
  isDevelopment: parsed.NODE_ENV === "development",
};
