// ---------------------------------------------------------------------------
// Datos de operación del proceso (PR-11 de docs-privados/auditoria-2026-10-21,
// local): qué versión corre y qué variables importantes faltan. Funciones
// puras sobre el entorno, para probarlas sin arrancar nada.
// ---------------------------------------------------------------------------

// OPS-08: el commit desplegado. Render define RENDER_GIT_COMMIT en cada deploy;
// en local no existe y la versión es "local". Siete caracteres, como los
// muestra GitHub: alcanza para buscar el commit y no dice nada más.
export function versionDesplegada(commit: string | undefined): string {
  const limpio = commit?.trim();
  return limpio ? limpio.slice(0, 7) : "local";
}

// OPS-10: las variables sin las que el backend arranca "verde" pero algo
// importante no anda. El esquema de env.ts las deja opcionales a propósito
// (para que el proceso arranque y /health responda aunque falte una
// integración); esta lista es la de "necesarias en producción" de
// docs/deployment.md §2.3, más las que apagan una función entera en silencio.
export const VARIABLES_DE_PRODUCCION: { nombre: string; sinElla: string }[] = [
  { nombre: "DATABASE_URL", sinElla: "ninguna ruta de negocio funciona" },
  { nombre: "SUPABASE_URL", sinElla: "no se puede verificar ninguna sesión" },
  {
    nombre: "SUPABASE_SERVICE_ROLE_KEY",
    sinElla: "invitaciones, altas de organización y fotos dan 500",
  },
  { nombre: "OPENROUTER_API_KEY", sinElla: "el agente y el asistente de ayuda no responden" },
  {
    nombre: "WHATSAPP_ACCESS_TOKEN",
    sinElla: "no sale ningún WhatsApp y el webhook da 500",
  },
  {
    nombre: "WHATSAPP_APP_SECRET",
    sinElla: "el webhook de WhatsApp da 500 y no entra ningún mensaje",
  },
  { nombre: "QR_RESOLVE_PROXY_SECRET", sinElla: "todos los escaneos de QR dan 404" },
  { nombre: "SECRET_ENCRYPTION_KEY", sinElla: "Google Calendar da 500" },
];

export function variablesQueFaltan(entorno: Record<string, string | undefined>): string[] {
  return VARIABLES_DE_PRODUCCION.filter(({ nombre }) => !entorno[nombre]?.trim()).map(
    ({ nombre, sinElla }) => `${nombre} (${sinElla})`,
  );
}
