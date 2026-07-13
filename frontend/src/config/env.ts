function required(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${key}`);
  }
  return value;
}

// Valida con la API nativa URL — sin librería. Además del try/catch del
// constructor (que ya cubre "no es una URL absoluta"), chequea el
// protocolo explícitamente: new URL("localhost:4000") NO tira, porque el
// parser interpreta "localhost" como esquema — un typo real y silencioso
// si alguien olvida el "http://".
function requiredAbsoluteUrl(key: keyof ImportMetaEnv): string {
  const raw = required(key);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} debe ser una URL absoluta válida (recibido: "${raw}")`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${key} debe usar http o https (recibido: "${raw}")`);
  }
  return raw;
}

// Centraliza acá la normalización de la barra final de VITE_API_URL: es el
// único punto de la app que arma esta variable, así que es el único lugar
// donde hace falta corregirla. src/lib/api.ts confía ciegamente en que
// env.apiUrl nunca termina en "/".
function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const env = {
  supabaseUrl: requiredAbsoluteUrl("VITE_SUPABASE_URL"),
  // Solo presencia/no-vacío — sin validar el formato interno del token:
  // Supabase no garantiza públicamente que siga siendo un JWT para
  // siempre, y no hay ninguna necesidad concreta hoy de acoplarse a eso.
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY"),
  apiUrl: stripTrailingSlash(requiredAbsoluteUrl("VITE_API_URL")),
};
