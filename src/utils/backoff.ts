// ---------------------------------------------------------------------------
// Reintentos con backoff exponencial — las decisiones PURAS que gobiernan una
// cola con reintentos, sin base y sin red.
//
// Nacieron en outbox.service.ts y se movieron acá con B-30 de
// docs/auditoria-2026-08-29.md, cuando la cola de ingesta ganó el mismo
// mecanismo: no tienen NADA específico de outbox en su firma (números y una
// Date, ningún OutboxEvent), y dejarlas allá habría obligado a la capa de
// ingesta a importar de un archivo llamado outbox.service.ts o a duplicar la
// matemática. outbox.service.ts las reexporta, así que sus consumidores y sus
// tests existentes no cambiaron. La LÓGICA es la de siempre, movida sin tocar.
// ---------------------------------------------------------------------------

export interface ParametrosDeBackoff {
  baseMs: number;
  topeMs: number;
}

// Backoff exponencial: base * 2^(intentosPrevios), acotado por topeMs.
//
// `intentosPrevios` es el valor de attempts ANTES de este fallo, no después. Con
// base 30 s eso da 30 s, 1 m, 2 m, 4 m… — el primer reintento espera la base,
// no el doble. Pasarle el contador ya incrementado correría toda la escala un
// lugar, que es el error clásico de esta función y el motivo de que el
// parámetro se llame así y no `attempts`.
//
// El tope existe para que subir el máximo de intentos no produzca esperas de
// días por la duplicación. Con los defaults no se alcanza.
export function calcularEsperaDeBackoff(
  intentosPrevios: number,
  parametros: ParametrosDeBackoff,
): number {
  // Math.min contra el tope ANTES de multiplicar evitaría el overflow, pero con
  // un exponente grande 2**n ya es Infinity y Math.min lo resuelve igual:
  // Infinity acotado por topeMs es topeMs. No hace falta acotar el exponente.
  const espera = parametros.baseMs * Math.pow(2, Math.max(0, intentosPrevios));
  return Math.min(espera, parametros.topeMs);
}

export interface ResolucionDeFallo {
  estado: "REINTENTAR" | "DEAD_LETTER";
  attempts: number;
  nextAttemptAt: Date | null;
}

// Qué hacer con un evento cuyo intento falló. Pura y por eso testeable sin
// base: es la única lógica de estas colas donde un error de más/de menos cambia
// si un evento se pierde o se reintenta para siempre.
//
// `attempts` sube SIEMPRE, incluso en el camino a DEAD_LETTER: la fila tiene que
// poder decir cuántas veces se intentó de verdad. Un DEAD_LETTER con attempts
// congelado en el valor anterior haría creer que quedaba un intento sin usar.
export function resolverFallo(
  intentosPrevios: number,
  ahora: Date,
  limites: { maxIntentos: number; backoff: ParametrosDeBackoff },
): ResolucionDeFallo {
  const attempts = intentosPrevios + 1;

  if (attempts >= limites.maxIntentos) {
    return { estado: "DEAD_LETTER", attempts, nextAttemptAt: null };
  }

  const espera = calcularEsperaDeBackoff(intentosPrevios, limites.backoff);
  return {
    estado: "REINTENTAR",
    attempts,
    nextAttemptAt: new Date(ahora.getTime() + espera),
  };
}

// Un Error puede traer un mensaje enorme (un stack, un cuerpo de respuesta
// HTTP). last_error es TEXT y aguanta, pero una fila de auditoría con 400 KB de
// stack no es más útil que una con 500 caracteres: se recorta.
const LARGO_MAXIMO_DE_ERROR = 500;

export function describirError(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err);
  const limpio = texto.trim() || "el handler falló sin mensaje";
  return limpio.length > LARGO_MAXIMO_DE_ERROR
    ? `${limpio.slice(0, LARGO_MAXIMO_DE_ERROR)}…`
    : limpio;
}
