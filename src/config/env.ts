import "dotenv/config";
import { z } from "zod";

// DATABASE_URL, DIRECT_URL y las variables SUPABASE_* quedaron opcionales acá
// a propósito (ver src/lib/*.ts): cada consumidor valida su propia presencia
// en el momento de uso (lib/jwt.ts, lib/supabaseAdmin.ts), así el servidor
// sigue arrancando y /health sigue funcionando aunque falte alguna.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN es requerido"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional(),

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
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${issues}`,
    );
  }

  return result.data;
}

const parsed = parseEnv();

export const env = {
  ...parsed,
  LOG_LEVEL:
    parsed.LOG_LEVEL ?? (parsed.NODE_ENV === "production" ? "info" : "debug"),
  isProduction: parsed.NODE_ENV === "production",
  isDevelopment: parsed.NODE_ENV === "development",
};
