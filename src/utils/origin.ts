// ---------------------------------------------------------------------------
// Normalización de un ORIGEN web (esquema + host [+ puerto]), para
// Agent.allowedOrigins (paso 5a del módulo de Agentes de IA). Lo usa el CRUD
// de agentes para validar y guardar cada entrada, y lo va a usar el endpoint
// público del widget (5b) para comparar el header Origin del request contra
// la lista guardada: como los dos lados pasan por acá, la comparación es por
// igualdad exacta de strings, sin sorpresas de mayúsculas, barras finales o
// puertos por defecto.
//
// Se apoya en el constructor URL de Node en vez de en una regex: es el mismo
// parser que usa el navegador para calcular el Origin que manda, así que lo
// que este archivo acepta y normaliza coincide con lo que va a llegar.
// ---------------------------------------------------------------------------

// Devuelve el origen normalizado (`url.origin`: esquema en minúsculas, host en
// minúsculas, sin puerto si es el default del esquema, sin barra final) o
// null si la entrada no es un origen válido:
//
//   - no parsea como URL, o no es http/https;
//   - trae path (cualquier cosa después del host que no sea la barra sola),
//     query o fragmento — un origen no los tiene, y aceptarlos haría que
//     "https://ejemplo.com/widget" se guardara como si autorizara algo
//     distinto de "https://ejemplo.com" cuando el navegador nunca manda el
//     path en Origin;
//   - trae credenciales (user:pass@).
//
// "https://ejemplo.com/" (barra sola) SE ACEPTA y se normaliza sin la barra:
// es cómo muchas herramientas muestran un origen, y URL la parsea con
// pathname "/" igual que sin ella.
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
  // La barra final sola es la única forma "con path" que se tolera; cualquier
  // otra ya fue rechazada por pathname !== "/". Pero "https://ejemplo.com/?"
  // o "https://ejemplo.com/#" parsean con search/hash vacíos: se rechazan
  // mirando el texto, porque no son un origen tal como lo escribe nadie.
  if (trimmed.endsWith("?") || trimmed.endsWith("#")) {
    return null;
  }

  return url.origin;
}
