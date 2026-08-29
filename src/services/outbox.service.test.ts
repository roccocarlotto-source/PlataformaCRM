import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularEsperaDeBackoff, describirError, resolverFallo } from "./outbox.service";
import { crearRegistroDeHandlers } from "./outboxHandlers";

// Unitarios, sin base ni red: acá vive la única lógica del motor donde un error
// de más o de menos cambia si un evento se pierde o se reintenta para siempre.
// El worker completo se prueba aparte, contra Postgres real
// (outboxWorker.integration-test.ts).

const BACKOFF = { baseMs: 30_000, topeMs: 15 * 60 * 1000 };
const AHORA = new Date("2026-08-28T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test("el PRIMER reintento espera la base, no el doble — el off-by-one clásico de esta función", () => {
  // intentosPrevios = 0 significa "todavía no se intentó nunca". Si acá saliera
  // 60 s en vez de 30 s, toda la escala estaría corrida un lugar y el último
  // intento caería al doble de lejos de lo previsto.
  assert.equal(calcularEsperaDeBackoff(0, BACKOFF), 30_000);
});

test("el backoff duplica por intento", () => {
  assert.equal(calcularEsperaDeBackoff(1, BACKOFF), 60_000);
  assert.equal(calcularEsperaDeBackoff(2, BACKOFF), 120_000);
  assert.equal(calcularEsperaDeBackoff(3, BACKOFF), 240_000);
});

test("el tope acota la espera, y sigue acotándola con exponentes absurdos", () => {
  assert.equal(calcularEsperaDeBackoff(20, BACKOFF), BACKOFF.topeMs);
  // 2**5000 es Infinity en JS. Math.min lo resuelve igual: sin esto habría que
  // acotar el exponente aparte.
  assert.equal(calcularEsperaDeBackoff(5000, BACKOFF), BACKOFF.topeMs);
});

test("un intentosPrevios negativo no produce una espera menor que la base", () => {
  // No debería llegar nunca —attempts arranca en 0 y solo sube— pero un valor
  // corrupto en la fila no puede traducirse en un reintento inmediato en bucle.
  assert.equal(calcularEsperaDeBackoff(-3, BACKOFF), 30_000);
});

// ---------------------------------------------------------------------------
// Resolución de un fallo
// ---------------------------------------------------------------------------

test("con intentos disponibles, un fallo reprograma: sube attempts y fija el próximo turno", () => {
  const resolucion = resolverFallo(0, AHORA, { maxIntentos: 5, backoff: BACKOFF });

  assert.equal(resolucion.estado, "REINTENTAR");
  assert.equal(resolucion.attempts, 1);
  assert.equal(resolucion.nextAttemptAt?.toISOString(), "2026-08-28T12:00:30.000Z");
});

test("al alcanzar el máximo, el fallo va a DEAD_LETTER en vez de programar otro reintento", () => {
  // Con maxIntentos = 5, el quinto fallo (intentosPrevios = 4) es el último.
  const resolucion = resolverFallo(4, AHORA, { maxIntentos: 5, backoff: BACKOFF });

  assert.equal(resolucion.estado, "DEAD_LETTER");
  assert.equal(resolucion.attempts, 5);
  assert.equal(resolucion.nextAttemptAt, null, "un DEAD_LETTER no tiene próximo turno");
});

test("attempts sube TAMBIÉN en el camino a DEAD_LETTER", () => {
  // Si quedara congelado en el valor anterior, la fila haría creer que sobraba
  // un intento sin usar.
  const resolucion = resolverFallo(4, AHORA, { maxIntentos: 5, backoff: BACKOFF });
  assert.equal(resolucion.attempts, 5);
});

test("el cuarto fallo todavía reintenta y el quinto ya no — el borde exacto del tope", () => {
  assert.equal(resolverFallo(3, AHORA, { maxIntentos: 5, backoff: BACKOFF }).estado, "REINTENTAR");
  assert.equal(resolverFallo(4, AHORA, { maxIntentos: 5, backoff: BACKOFF }).estado, "DEAD_LETTER");
});

test("con maxIntentos = 1 el primer fallo ya es terminal", () => {
  const resolucion = resolverFallo(0, AHORA, { maxIntentos: 1, backoff: BACKOFF });
  assert.equal(resolucion.estado, "DEAD_LETTER");
  assert.equal(resolucion.attempts, 1);
});

// ---------------------------------------------------------------------------
// Descripción del error
// ---------------------------------------------------------------------------

test("describirError toma el message de un Error y el String de cualquier otra cosa", () => {
  assert.equal(describirError(new Error("el destino respondió 503")), "el destino respondió 503");
  assert.equal(describirError("un string pelado"), "un string pelado");
});

test("un error sin mensaje no produce un lastError vacío", () => {
  // Una fila con last_error = "" no dice nada y es indistinguible de un bug del
  // motor. Mejor una frase que al menos identifique de dónde vino.
  assert.equal(describirError(new Error("   ")), "el handler falló sin mensaje");
});

test("un mensaje enorme se recorta: last_error es auditoría, no un volcado", () => {
  const largo = describirError(new Error("x".repeat(5000)));
  assert.ok(largo.length < 600, `quedó en ${String(largo.length)} caracteres`);
  assert.ok(largo.endsWith("…"), "el recorte tiene que ser visible");
});

// ---------------------------------------------------------------------------
// Registro de handlers
// ---------------------------------------------------------------------------

test("el registro devuelve el handler de su eventType, y undefined para uno desconocido", () => {
  const registro = crearRegistroDeHandlers();
  const handler = async () => undefined;

  registro.registrar("opportunity.won", handler);

  assert.equal(registro.obtener("opportunity.won"), handler);
  assert.equal(registro.obtener("booking.reminder_due"), undefined);
});

test("registrar dos veces el mismo eventType LANZA — no sobrescribe en silencio", () => {
  // Sobrescribir dejaría al segundo módulo importado ganándole al primero según
  // el orden de imports: un bug imposible de leer desde el código.
  const registro = crearRegistroDeHandlers();
  registro.registrar("opportunity.won", async () => undefined);

  assert.throws(() => {
    registro.registrar("opportunity.won", async () => undefined);
  }, /Ya hay un handler registrado/);
});

test("dos registros creados con la factory no comparten estado", () => {
  // Es la propiedad que hace que los tests no tengan que resetear un singleton
  // global entre casos.
  const uno = crearRegistroDeHandlers();
  const otro = crearRegistroDeHandlers();

  uno.registrar("opportunity.won", async () => undefined);

  assert.equal(otro.obtener("opportunity.won"), undefined);
  assert.deepEqual(otro.tiposRegistrados(), []);
});

test("tiposRegistrados devuelve los tipos ordenados — es lo que loguea el arranque", () => {
  const registro = crearRegistroDeHandlers();
  registro.registrar("opportunity.won", async () => undefined);
  registro.registrar("booking.reminder_due", async () => undefined);

  assert.deepEqual(registro.tiposRegistrados(), ["booking.reminder_due", "opportunity.won"]);
});
