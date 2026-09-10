import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

// Única instancia del cliente de Supabase para el browser — todo el resto
// de la app (auth, y eventualmente Realtime si se llegara a usar) importa
// esta instancia, nunca crea la suya.
//
// De las opciones de abajo depende el modelo de sesión completo de este
// CRM — por eso se dejan explícitas aunque tres coincidan con el default de
// supabase-js v2. `storage` es la excepción: NO es el default.
// - persistSession + storage: la sesión (access + refresh token) se guarda
//   en sessionStorage, no en el default de la librería (localStorage).
//   sessionStorage sobrevive a un F5 igual que localStorage, pero se borra
//   al cerrar la pestaña/el navegador — así cada apertura del programa
//   vuelve a pedir login (decisión de producto: ítem 6 de
//   docs/frontend-cambios-pendientes.md). Con localStorage la sesión
//   sobrevivía indefinidamente al cierre del navegador y el usuario entraba
//   directo sin loguearse.
// - autoRefreshToken: el SDK renueva el access token solo — Express nunca
//   maneja refresh (ver docs/authentication-architecture.md sección 3).
// - detectSessionInUrl: necesario para el link de invitación de Supabase
//   (usado desde M7, AcceptInvitationPage.tsx) — fijado explícitamente
//   desde M0, antes de que existiera ese consumidor, para no depender de
//   que el default de la librería no cambiara mientras tanto.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
