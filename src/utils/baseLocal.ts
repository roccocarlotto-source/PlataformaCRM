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
