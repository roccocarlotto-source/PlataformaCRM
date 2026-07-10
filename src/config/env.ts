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
