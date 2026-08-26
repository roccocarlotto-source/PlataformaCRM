import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Generación y hasheo de claves de ingesta (docs/ingestion-architecture.md §3).
//
// EL HASH ES DETERMINÍSTICO Y SIN SAL, Y ESO ES DELIBERADO.
//
// La sección 3 define que authenticateApiKey (ítem 4) "lee la clave, la
// hashea, busca la fila". Eso descarta bcrypt, scrypt y argon2 por
// construcción, no por preferencia: producen una sal distinta por fila, así
// que no hay ningún valor que buscar por igualdad — habría que traer todas las
// filas y verificar una por una, O(n) por request en el camino más caliente
// del sistema.
//
// Un hash rápido y sin sal parece un error porque asociamos "hashear" con
// contraseñas. La analogía es la que está mal. bcrypt existe porque una
// contraseña la elige un humano: el espacio real de búsqueda es chico, quien
// roba la tabla lo recorre offline, y lo único que lo frena es que cada
// intento cueste caro. La sal existe para que ese costo no se amortice entre
// filas.
//
// Una API key no es una contraseña: la genera el servidor, nadie la memoriza,
// nadie la elige. Con 256 bits de un CSPRNG el espacio es tan grande que el
// costo por intento deja de importar — recorrer 2^256 no se vuelve factible
// porque cada intento salga barato. Y una sal por fila no aportaría nada: su
// función es impedir que una tabla precomputada sirva para varias filas, y eso
// presupone entradas repetidas o predecibles. Dos claves aleatorias de 256
// bits no se repiten ni se precomputan.
//
// REQUISITO — la seguridad de todo esto no vive en SHA-256, vive enteramente
// acá abajo:
//
//   La clave se genera con randomBytes (CSPRNG del sistema operativo), con
//   API_KEY_SECRET_BYTES bytes. NUNCA con Math.random(), NUNCA con un UUID,
//   NUNCA con nada derivado de la organización, del nombre de la fuente ni de
//   un timestamp. Si esta línea se debilita, SHA-256 pasa de ser una elección
//   correcta a ser un agujero, y NADA en el resto del sistema lo compensa.
//
// Un UUIDv4 sería el error tentador: da 122 bits (alcanzarían en la práctica)
// pero viene de un generador cuyo contrato es unicidad, no imprevisibilidad.
// Es el primitivo equivocado aunque el número cierre.
//
// PARA EL ÍTEM 4, dos restricciones que no son opcionales:
//
//   1. hashApiKey debe recibir LOS BYTES EXACTOS QUE LLEGAN EN EL HEADER. Sin
//      trim, sin toLowerCase, sin normalización Unicode, sin nada. Cualquier
//      normalización haría que dos cadenas distintas resuelvan a la misma
//      fila, que es exactamente lo contrario de lo que el hash está haciendo.
//      Si el header viene con espacios, la clave es inválida — y debe serlo.
//
//   2. LA CLAVE NUNCA VIAJA POR LA URL. Los serializers por defecto de
//      pino-http (pino-std-serializers, lib/req.js) escriben `url`, `query` y
//      `params` en cada línea de log. `redact` cubre headers, no la URL:
//      aceptar la clave por querystring sería un leak inmediato y silencioso.
//      Va en el header X-API-Key, que lib/logger.ts ya redacta.
// ---------------------------------------------------------------------------

// Prefijo legible en la clave misma, para que sea identificable a simple vista
// (en un log de un tercero, en un .env, en un ticket de soporte) y para que el
// ítem 4 pueda rechazar temprano lo que evidentemente no es una clave nuestra.
export const API_KEY_PREFIX = "crm_";

// 32 bytes = 256 bits. Ver el requisito de arriba.
export const API_KEY_SECRET_BYTES = 32;

// Cuántos caracteres de la clave se guardan en claro en ApiKey.keyPrefix para
// poder identificarla en la UI. 12 = API_KEY_PREFIX (4) + 8 caracteres del
// secreto, y entra en el VarChar(16) de la columna.
//
// Esos 8 caracteres base64url exponen 48 bits y dejan 208 ocultos. La cuenta
// queda escrita a propósito: es el margen que hace aceptable mostrar parte del
// secreto, y sin él la UI no podría decirle a nadie CUÁL de sus tres claves
// está por revocar.
export const API_KEY_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  // La clave en claro. Se devuelve UNA sola vez, en la respuesta de creación,
  // y no se persiste en ningún lado. No adjuntarla a `req`, no meterla en un
  // AppError, no loguearla ni en debug.
  key: string;
  keyPrefix: string;
  keyHash: string;
}

// base64url en vez de hex: misma entropía en 43 caracteres en vez de 64, y sin
// caracteres que necesiten escaparse en un header, una URL o un archivo .env.
export function generateApiKey(): GeneratedApiKey {
  const key = API_KEY_PREFIX + randomBytes(API_KEY_SECRET_BYTES).toString("base64url");

  return {
    key,
    keyPrefix: key.slice(0, API_KEY_PREFIX_LENGTH),
    keyHash: hashApiKey(key),
  };
}

// Se hashea la cadena COMPLETA, prefijo incluido: el ítem 4 hashea lo que
// llegue en el header sin tener que parsearlo ni separarlo en partes.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
