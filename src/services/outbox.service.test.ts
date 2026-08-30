import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { logger } from "../lib/logger";
import {
  calcularEsperaDeBackoff,
  describirError,
  ejecutarConTope,
  resolverFallo,
} from "./outbox.service";
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

// ---------------------------------------------------------------------------
// ejecutarConTope — M-14 de docs/auditoria-2026-08-29.md
//
// Sin base ni red: la función no toca Prisma. Los topes son chicos (10-20 ms)
// porque el VALOR del tope no es lo que se prueba, solo que se respete; y no
// hace falta mock.timers porque abort() y reject() corren en el MISMO callback
// del setTimeout, así que "en cuanto ejecutarConTope rechaza, la señal ya está
// abortada" es determinístico.
// ---------------------------------------------------------------------------

test("un handler que completa antes del tope resuelve, y su señal NO queda abortada", async () => {
  let capturada: AbortSignal | undefined;

  await ejecutarConTope(async (signal) => {
    capturada = signal;
  }, 1_000);

  assert.ok(capturada);
  assert.equal(capturada.aborted, false);
});

test("un handler que no responde: al vencer el tope rechaza con 'no respondió en N ms' y la señal ya está abortada", async () => {
  let capturada: AbortSignal | undefined;

  await assert.rejects(
    ejecutarConTope((signal) => {
      capturada = signal;
      return new Promise<void>(() => undefined);
    }, 15),
    /no respondió en 15 ms/,
  );

  assert.ok(capturada);
  assert.equal(capturada.aborted, true);
  assert.match(String((capturada.reason as Error).message), /no respondió en 15 ms/);
});

test("un handler que RESPETA la señal se para solo al vencer el tope", async () => {
  let seParo = false;

  await assert.rejects(
    ejecutarConTope(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          // Lo que haría fetch(url, { signal }) por dentro: escuchar el abort y
          // cortar. Es el único mecanismo por el que un handler deja de
          // competir con el reintento.
          signal.addEventListener("abort", () => {
            seParo = true;
            reject(signal.reason as Error);
          });
        }),
      15,
    ),
  );

  assert.equal(seParo, true);
});

test("un handler que IGNORA la señal y falla DESPUÉS del tope queda logueado en warn con su error real", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  let fallarTarde: (err: Error) => void = () => undefined;

  try {
    await assert.rejects(
      ejecutarConTope(
        () =>
          new Promise<void>((_resolve, reject) => {
            fallarTarde = reject;
          }),
        15,
      ),
      /no respondió en 15 ms/,
    );
    assert.equal(warn.mock.callCount(), 0, "hasta acá no hay nada que loguear");

    // El handler sigue vivo y ahora falla, cuando el intento ya se reprogramó.
    // Sin la rama nueva, esto era una excepción que nadie escuchaba.
    const tardio = new Error("el destino respondió 503, pero a los 12 segundos");
    fallarTarde(tardio);
    await new Promise((r) => setImmediate(r));

    assert.equal(warn.mock.callCount(), 1);
    const [payload, mensaje] = warn.mock.calls[0].arguments as [{ err: unknown }, string];
    assert.equal(payload.err, tardio);
    assert.match(mensaje, /después de vencer su propio tope/);
  } finally {
    warn.mock.restore();
  }
});

test("control: un handler que falla ANTES del tope rechaza con SU error, sin warn — ese camino lo maneja entregarEvento", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  let capturada: AbortSignal | undefined;

  try {
    await assert.rejects(
      ejecutarConTope(async (signal) => {
        capturada = signal;
        throw new Error("el destino respondió 503");
      }, 1_000),
      /el destino respondió 503/,
    );
    await new Promise((r) => setImmediate(r));

    assert.equal(warn.mock.callCount(), 0);
    assert.ok(capturada);
    assert.equal(capturada.aborted, false, "el tope no venció: no hay nada que abortar");
  } finally {
    warn.mock.restore();
  }
});

test("un handler que IGNORA la señal y completa tarde no loguea nada — no hay fallo que registrar", async () => {
  const warn = mock.method(logger, "warn", () => undefined);
  let completarTarde: () => void = () => undefined;

  try {
    await assert.rejects(
      ejecutarConTope(
        () =>
          new Promise<void>((resolve) => {
            completarTarde = resolve;
          }),
        15,
      ),
    );
    completarTarde();
    await new Promise((r) => setImmediate(r));

    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});
