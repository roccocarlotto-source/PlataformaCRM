import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

// Cliente de Supabase con privilegios de service_role — bypassea RLS y puede
// crear/borrar usuarios de auth.users vía la Admin API. Uso EXCLUSIVO de
// operaciones administrativas del backend (nunca la anon key para esto, ver
// docs/authentication-architecture.md). Nunca exponer esta instancia ni sus
// respuestas crudas al cliente.
let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(
      "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configurados en el servidor",
      500,
    );
  }

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
