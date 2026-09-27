// ¿Esta connection string apunta a una base en esta misma máquina? Es la
// pregunta que se hacen los frenos de seguridad del repo antes de hacer algo
// que no debe pasar contra producción: los scripts de sondeo y siembra
// (scripts/sonda-matriz-crm.ts, scripts/seed-dev-data.ts) y el arranque de los
// workers en desarrollo (workersHabilitados.ts, G-02 de la auditoría del
// 24/09). Vive en un solo lugar para que los tres respondan lo mismo.
//
// Se compara el hostname PARSEADO, no un substring de la URL: una contraseña o
// un nombre de base que contengan "localhost" no pueden colar una URL remota.
// Una URL que no se puede parsear no es local: si no se puede comprobar, el
// freno frena.

// new URL() devuelve las IPv6 entre corchetes ("[::1]").
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function esHostLocal(hostname: string): boolean {
  return HOSTS_LOCALES.has(hostname.toLowerCase());
}

export function hostDeLaUrl(url: string | undefined): string | null {
  if (!url || url.trim().length === 0) return null;
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return null;
  }
}

export function esUrlDeBaseLocal(url: string | undefined): boolean {
  const host = hostDeLaUrl(url);
  return host !== null && esHostLocal(host);
}

// ---------------------------------------------------------------------------
// El freno de la suite de integración: con NODE_ENV=test, DATABASE_URL y
// DIRECT_URL tienen que ser locales, o el proceso aborta.
//
// POR QUÉ EXISTE — incidente del 27/09/2026: `npm run test:integration` corrió
// ~1100 tests contra la base de PRODUCCIÓN. @prisma/client carga `.env` por su
// cuenta AL IMPORTARSE (no al construir el cliente), y en los archivos de test
// se importaba antes que config/env.ts; como dotenv no pisa variables ya
// seteadas, `.env.test` llegaba tarde y DATABASE_URL quedaba la del `.env`
// (el proyecto real). El arreglo de raíz es la precarga de config/env.ts en
// `test:integration` (package.json); esto es la red por si otro camino vuelve
// a abrir el mismo agujero: la suite falla ruidosamente en el primer archivo
// en vez de correr contra producción.
//
// Una variable SIN setear no frena acá: sin URL no hay a qué conectarse, y
// Prisma falla solo. Lo peligroso es una URL remota.
// ---------------------------------------------------------------------------
export function assertBaseLocalEnTest(entorno: {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
}): void {
  if (entorno.NODE_ENV !== "test") return;
  for (const nombre of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const url = entorno[nombre];
    if (url !== undefined && url.trim() !== "" && !esUrlDeBaseLocal(url)) {
      throw new Error(
        `NODE_ENV=test con ${nombre} apuntando a una base que NO es local ` +
          `(${hostDeLaUrl(url) ?? "URL imparseable"}). Se aborta para no correr ` +
          "tests contra una base real. La suite de integración va contra el " +
          "Supabase local (`npm run supabase:start`, `.env.test`).",
      );
    }
  }
}
