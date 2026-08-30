import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

// Cliente de Supabase con la clave `anon` — el complemento de supabaseAdmin,
// no su reemplazo. Se agregó con ALTO-2 (verificación de email en el registro).
//
// POR QUÉ HACE FALTA UNO SEGUNDO. `signInWithOtp` y `verifyOtp` no son
// operaciones administrativas: son las dos mitades de "esta persona demuestra
// que controla este email". La Admin API no las expone, y no debería —
// `generateLink` es lo más cercano que tiene y no envía el mail, así que
// exigiría un proveedor de email propio que este repo no tiene.
//
// La regla que ya rige en supabaseAdmin.ts sigue intacta y esto no la afloja:
// crear, modificar o borrar usuarios va SIEMPRE por el cliente de service_role;
// pedir y verificar un código de un solo uso va por el anon, que es
// exactamente el privilegio que esa operación necesita. Cada clave hace lo suyo.
//
// SUPABASE_ANON_KEY ya estaba en .env.example y en config/env.ts (la consumía
// el frontend). No se agregó ninguna variable de entorno nueva.
let client: SupabaseClient | undefined;

export function getSupabaseAnon(): SupabaseClient {
  if (client) {
    return client;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    // isOperational: false — nombra variables de entorno; es para el log, no
    // para el cliente (M-11 b, mismo criterio que supabaseAdmin).
    throw new AppError(
      "SUPABASE_URL o SUPABASE_ANON_KEY no están configurados en el servidor",
      500,
      false,
    );
  }

  // persistSession/autoRefreshToken en false, mismo criterio que supabaseAdmin:
  // este proceso es un servidor sin navegador ni almacenamiento por usuario. Sin
  // esto, la sesión que devuelve verifyOtp quedaría guardada en memoria del
  // proceso y compartida entre requests — un usuario "logueado" a nivel módulo,
  // que es justo lo que no queremos: la sesión del registro se descarta, el
  // frontend hace su propio login con la contraseña que se acaba de fijar.
  client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
