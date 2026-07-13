import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

// Única instancia del cliente de Supabase para el browser — todo el resto
// de la app (auth, y eventualmente Realtime si se llegara a usar) importa
// esta instancia, nunca crea la suya.
//
// Las tres opciones de abajo ya son el default de supabase-js v2 — se
// dejan explícitas porque de ellas depende el modelo de sesión completo de
// este CRM, no por costumbre:
// - persistSession: la sesión sobrevive a un F5 (localStorage).
// - autoRefreshToken: el SDK renueva el access token solo — Express nunca
//   maneja refresh (ver docs/authentication-architecture.md sección 3).
// - detectSessionInUrl: necesario para el link de invitación de Supabase
//   (M8) — no se usa todavía en M0, pero el valor por defecto que
//   necesitamos más adelante queda fijado desde ahora, no librado a que
//   cambie el default de la librería.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
