// ---------------------------------------------------------------------------
// Fechas para las filas de cola que un test de integración va a reclamar YA.
//
// Las colas deciden si una fila es reclamable con el reloj de POSTGRES:
// `coalesce(next_attempt_at, created_at) <= now()` (claimNextPendingEvent en
// ingestionEvent.repository.ts). Pero created_at lo escribe Prisma con el
// reloj de NODE: `@default(now())` se resuelve en el cliente y viaja como
// parámetro del INSERT. Si el reloj de Node va adelantado respecto del de la
// base, una fila recién creada queda en el "futuro" de la base y el drenado de
// la línea siguiente no la ve: el test lee PENDING donde esperaba PROCESSED.
//
// En local pasa: Postgres corre en la VM de Docker (WSL2), cuyo reloj se
// desfasa del de Windows por momentos —sobre todo después de suspender la
// máquina— hasta que se resincroniza. Era la intermitencia de F5-a
// (ingestionEvent.controller.integration-test.ts, 03/10/2026) y la de los
// B-30 de ingestionWorker.integration-test.ts: fallaban una vez, corridos solos
// también, y después pasaban siempre. Con el desfase forzado a +200 ms fallan
// de forma determinística los cuatro.
//
// En producción no es un problema: el worker reclama en el tick siguiente,
// segundos después, y el desfase entre servidores con NTP es de milisegundos.
// Es del test, que drena en el mismo milisegundo en que crea. Por eso el
// arreglo es acá y no en la query.
//
// Un minuto de margen: mucho más que cualquier desfase real, y nada que estos
// tests miren depende de la hora exacta de creación.
// ---------------------------------------------------------------------------

export const MARGEN_DE_RELOJ_MS = 60_000;

// Un instante que la base ya considera pasado aunque los relojes no coincidan.
export function yaReclamable(): Date {
  return new Date(Date.now() - MARGEN_DE_RELOJ_MS);
}
