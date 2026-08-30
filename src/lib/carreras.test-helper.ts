import assert from "node:assert/strict";
import { prisma, type Db } from "./prisma";

// ---------------------------------------------------------------------------
// Carreras forzadas contra Postgres real — M-19 de docs/auditoria-2026-08-29.md.
//
// SOLO PARA TESTS (el nombre *.test-helper.ts lo deja fuera del build). Es la
// técnica que activity.service.integration-test.ts ya usaba, extraída para
// que los cinco archivos que M-19 señala la compartan en vez de copiarla:
//
//   1. Una transacción A, de control, toma el MISMO lock real que tomaría la
//      operación rival (llamando a la misma función lock*ForUpdate, nunca a
//      una reimplementación) y, si hace falta, aplica el efecto de esa
//      operación rival. No commitea hasta que el test la libere: nunca por
//      tiempo, siempre por señal.
//   2. Se lanza la llamada REAL al service (B) sin esperarla.
//   3. Se hace polling contra pg_stat_activity / pg_blocking_pids hasta que
//      Postgres mismo diga que el backend de B está esperando el lock que A
//      sostiene. Esa —y no un setTimeout— es la señal de que B llegó a su
//      escritura real y de que el lock existe.
//   4. Recién ahí se libera A y se observa el resultado de B.
//
// POR QUÉ ESTO SÍ DISTINGUE EL CÓDIGO CORRECTO DEL ROTO, y Promise.allSettled
// no: si el lock*ForUpdate desapareciera del service, B no se bloquearía nunca
// —terminaría antes de que A commitee, decidiendo sobre un estado viejo— y el
// paso 3 lo detecta de dos formas: B se resuelve sin haberse bloqueado, o el
// plazo vence sin que ningún backend aparezca bloqueado por A. Las dos son
// fallos deterministas, no una tasa.
// ---------------------------------------------------------------------------

export interface TransaccionSostenida {
  // pid del backend de Postgres de la transacción A.
  pid: number;
  // Deja que A commitee. Idempotente.
  liberar: () => void;
  // Resuelve cuando A commiteó (o rechaza si A falló).
  terminada: Promise<void>;
}

// Abre la transacción A, ejecuta `sostener(tx)` —que tiene que tomar el lock
// y, opcionalmente, escribir— y la deja abierta hasta `liberar()`. Resuelve
// cuando `sostener` terminó, o sea cuando el lock ya está tomado.
export async function sostenerTransaccion(
  sostener: (tx: Db) => Promise<void>,
): Promise<TransaccionSostenida> {
  let pid: number | undefined;
  let liberar: () => void = () => undefined;
  const liberada = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  let avisarListo: () => void = () => undefined;
  let avisarFallo: (err: unknown) => void = () => undefined;
  const lista = new Promise<void>((resolve, reject) => {
    avisarListo = resolve;
    avisarFallo = reject;
  });

  // maxWait/timeout generosos: el plazo real lo administra `liberar`, no el
  // timeout por defecto de $transaction (5 s), corto para este polling.
  const terminada = prisma
    .$transaction(
      async (tx) => {
        const fila = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid = fila[0].pid;
        try {
          await sostener(tx);
        } catch (err) {
          avisarFallo(err);
          throw err;
        }
        avisarListo();
        await liberada;
      },
      { maxWait: 15_000, timeout: 30_000 },
    )
    .then(() => undefined);
  // Si A falla antes de que el test la espere, que no sea un unhandledRejection.
  terminada.catch(() => undefined);

  await lista;
  assert.ok(pid !== undefined, "la transacción A tiene que conocer su propio pid");
  return { pid, liberar, terminada };
}

// Espera hasta que algún backend esté bloqueado por el pid de A. Falla rápido
// si la promesa de B se resuelve o rechaza ANTES de haberse bloqueado —el
// síntoma exacto de un lock ausente—, y falla por plazo si nadie aparece
// bloqueado. En los dos casos libera A antes de fallar: si no, A seguiría
// sosteniendo sus filas y el teardown del test esperaría el timeout entero de
// su transacción.
export async function esperarBloqueadoPor(
  a: TransaccionSostenida,
  promesaDeB: Promise<unknown>,
  etiqueta: string,
  plazoMs = 10_000,
): Promise<void> {
  const pid = a.pid;
  let bTermino = false;
  promesaDeB.then(
    () => {
      bTermino = true;
    },
    () => {
      bTermino = true;
    },
  );

  const limite = Date.now() + plazoMs;
  while (Date.now() < limite) {
    const filas = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (filas.length > 0) {
      return;
    }
    if (bTermino) {
      a.liberar();
      assert.fail(
        `${etiqueta}: la llamada real terminó SIN haberse bloqueado contra el lock de A — ` +
          `decidió sobre un estado viejo. Es exactamente lo que pasa si el lock*ForUpdate no existe.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  a.liberar();
  assert.fail(
    `${etiqueta}: en ${String(plazoMs)} ms ningún backend apareció bloqueado por el lock de A (pid ${String(pid)}) — ` +
      `no se puede afirmar que la llamada real alcanzó su escritura real.`,
  );
}

// Los pids que tienen una transacción abierta ahora mismo, de entre los dados.
// Es la señal de SOLAPAMIENTO real para el caso en que las dos transacciones
// no se bloquean entre sí (SKIP LOCKED): vivas a la vez en Postgres, no una
// después de la otra.
export async function pidsConTransaccionAbierta(pids: number[]): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE pid = ANY(${pids}::int[]) AND xact_start IS NOT NULL
  `;
  return filas.map((f) => f.pid).sort((a, b) => a - b);
}
