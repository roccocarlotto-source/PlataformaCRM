// ---------------------------------------------------------------------------
// Validación y normalización de un ORIGEN web para `Agent.allowedOrigins`
// (ítem 63 de docs/frontend-cambios-pendientes.md).
//
// ES UN ESPEJO DEL BACKEND, NO UN REEMPLAZO. Quien decide sigue siendo
// `originSchema`/`allowedOriginsSchema` de src/controllers/agent.controller.ts,
// que a su vez llama a `normalizeOrigin` de src/utils/origin.ts. Acá se repite
// la MISMA regla para que un dominio mal escrito se vea en el momento de
// agregarlo y no después de guardar, y —lo que importa más— para que la lista
// que se muestra en pantalla sea exactamente la que el backend va a guardar:
// las dos puntas normalizan con el constructor `URL`, así que
// "https://Ejemplo.com/" se ve como "https://ejemplo.com" antes de viajar, y
// no cambia de forma al recargar.
//
// Mismo criterio de "espejo en código" que `MODEL_PROVIDER_OPTIONS` en
// labels.ts o `catalog.ts` en features/automation: no hay ningún endpoint que
// exponga estas reglas, así que la alternativa a copiarlas sería mandar cada
// dominio al servidor para preguntarle si es válido.
// ---------------------------------------------------------------------------

// Los dos topes de allowedOriginsSchema/originSchema, con el mismo valor.
export const ORIGEN_MAX_LENGTH = 255;
export const ORIGENES_MAX_ITEMS = 50;

// Copia literal de src/utils/origin.ts: mismo parser (URL), mismos rechazos
// (esquema distinto de http/https, path, query, fragmento, credenciales) y
// misma tolerancia con la barra final sola. Devuelve el origen normalizado
// (`url.origin`) o null.
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return null;
  }
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  // "https://ejemplo.com/?" y "https://ejemplo.com/#" parsean con search/hash
  // vacíos: se rechazan mirando el texto, porque no son un origen tal como lo
  // escribe nadie.
  if (trimmed.endsWith("?") || trimmed.endsWith("#")) {
    return null;
  }

  return url.origin;
}

export type ResultadoDeOrigen = { ok: true; origen: string } | { ok: false; error: string };

// Todo lo que la pantalla necesita saber para decidir si un dominio tipeado
// entra a la lista, con el mensaje ya escrito. Vive acá y no en el componente
// para poder probar las reglas directamente, sin pasar por el DOM.
//
// El orden de los chequeos es el del backend: primero el largo (originSchema
// valida `.max(255)` ANTES de transformar), después la forma, y al final los
// dos que son de la LISTA y no del origen suelto — el duplicado (el backend
// lo deduplica en silencio, acá se avisa en vez de tragárselo) y el tope de
// 50 entradas.
export function validarOrigen(raw: string, yaEnLista: readonly string[]): ResultadoDeOrigen {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Escribí un dominio, por ejemplo https://ejemplo.com" };
  }
  if (trimmed.length > ORIGEN_MAX_LENGTH) {
    return {
      ok: false,
      error: `Un dominio no puede superar los ${ORIGEN_MAX_LENGTH} caracteres.`,
    };
  }

  const origen = normalizeOrigin(trimmed);
  if (origen === null) {
    return {
      ok: false,
      error: `"${trimmed}" no es un dominio válido: se espera http:// o https:// y el dominio, sin ninguna ruta después (ej. https://ejemplo.com).`,
    };
  }

  if (yaEnLista.includes(origen)) {
    return { ok: false, error: `${origen} ya está en la lista.` };
  }
  if (yaEnLista.length >= ORIGENES_MAX_ITEMS) {
    return {
      ok: false,
      error: `No se pueden agregar más de ${ORIGENES_MAX_ITEMS} dominios.`,
    };
  }

  return { ok: true, origen };
}
