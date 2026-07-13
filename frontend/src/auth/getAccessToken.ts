import { supabase } from "../lib/supabase";

// Puente entre api.ts (que no conoce Supabase) y el cliente único de
// supabase.ts. getSession() refresca la sesión sola si hace falta antes de
// devolverla — llamarlo justo antes de cada request evita enviar un token
// que el propio SDK ya sabe que está vencido.
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
