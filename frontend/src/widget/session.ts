// ---------------------------------------------------------------------------
// sessionId del visitante (docs/ai-agent-architecture.md §10, canal Web,
// punto 4): un UUID que el navegador genera una vez y manda en cada mensaje.
// Es lo único que permite reencontrar la misma Conversation (y el mismo
// Contact placeholder) entre recargas dentro del mismo navegador.
//
// Scopeado por agentId dentro del origen: si una misma página embebiera dos
// agentes distintos, cada uno tendría su propia sesión. No es el caso
// pensado, pero evitar el cruce es gratis.
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = "plataforma-crm-widget:session:";

function storageKey(agentId: string): string {
  return `${STORAGE_KEY_PREFIX}${agentId}`;
}

// crypto.randomUUID() solo existe en contextos seguros (https o localhost).
// El widget se embebe en el sitio de OTRO negocio, que puede servirse por
// http plano — ahí randomUUID es undefined pero getRandomValues sigue
// disponible, así que se arma un UUID v4 a mano con eso. El backend trata
// el sessionId como un identificador opaco de hasta 200 caracteres, no le
// importa la versión.
export function generateSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// localStorage puede TIRAR al tocarlo (modo privado en algunos navegadores,
// storage bloqueado por política del sitio, cuota agotada) o no existir.
// Nada de eso tiene por qué romper el widget entero: si falla, se genera un
// id en memoria para esta carga de página. Se pierde la continuidad entre
// recargas, pero el chat de esta sesión funciona igual.
export function getOrCreateSessionId(agentId: string): string {
  const key = storageKey(agentId);

  let stored: string | null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    stored = null;
  }
  if (stored) return stored;

  const fresh = generateSessionId();
  try {
    localStorage.setItem(key, fresh);
  } catch {
    // Sin persistencia: el id vive solo en memoria. Deliberadamente silencioso.
  }
  return fresh;
}
