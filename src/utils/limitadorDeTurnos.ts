// ---------------------------------------------------------------------------
// Cuántos turnos del agente pueden tener tomado el lock por conversación a la
// vez, y dónde esperan los demás — C-12 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
//
// El lock por conversación (conLockDeConversacion, ítem 126) se sostiene con
// una transacción abierta durante todo el turno, y el turno hace sus consultas
// por OTRAS conexiones del pool. Hasta este cambio, cada turno en curso y cada
// turno que esperaba el lock del mismo contacto ocupaban una conexión cada
// uno: con el embed token público del widget alcanzaba con mandar unos pocos
// mensajes seguidos en la misma sesión para llenar el pool, y entonces ni el
// turno que tenía el lock conseguía conexión para sus consultas (P2024) ni el
// resto del backend, de todas las organizaciones.
//
// Dos cosas, las dos en memoria (el backend es UN proceso — G-04 de la
// auditoría del 24/09; el advisory lock de la base sigue siendo la garantía
// entre procesos):
//
//   1. Una cola por clave: el segundo turno del mismo contacto espera acá,
//      sin conexión, a que termine el primero. Recién entonces abre su
//      transacción. Diez mensajes seguidos de la misma sesión ocupan una
//      conexión, no diez.
//   2. Un cupo global: nunca hay más de `maximo` turnos con la transacción del
//      lock abierta. Los que exceden esperan acá, también sin conexión. Así
//      siempre queda pool libre para las consultas de los turnos en curso y
//      para el resto de la API.
//
// El orden es ese a propósito: primero la cola de la clave, después el cupo.
// Un turno que espera a otro del mismo contacto no ocupa un lugar del cupo.
// ---------------------------------------------------------------------------

export interface LimitadorDeTurnos {
  correr<T>(clave: string, fn: () => Promise<T>): Promise<T>;
  // Para los tests y para el log: cuántos tienen el cupo y cuántos lo esperan.
  enCurso(): number;
  esperandoCupo(): number;
}

export function crearLimitadorDeTurnos(maximo: number): LimitadorDeTurnos {
  if (!Number.isInteger(maximo) || maximo < 1) {
    throw new Error(`El cupo de turnos tiene que ser un entero positivo (vino ${maximo})`);
  }

  // La cola de cada clave es una cadena de promesas: cada turno espera la cola
  // que encontró y deja la suya como la nueva cola. La entrada se borra cuando
  // el último de la cadena termina, así el Map no crece con cada contacto.
  const colas = new Map<string, Promise<void>>();
  let enCurso = 0;
  const esperandoCupo: Array<() => void> = [];

  async function tomarCupo(): Promise<void> {
    if (enCurso < maximo) {
      enCurso++;
      return;
    }
    // FIFO: el que libera le pasa su lugar directo al primero de la fila, sin
    // bajar y volver a subir el contador (nadie más se puede colar entre medio).
    await new Promise<void>((resolve) => esperandoCupo.push(resolve));
  }

  function soltarCupo(): void {
    const siguiente = esperandoCupo.shift();
    if (siguiente) {
      siguiente();
    } else {
      enCurso--;
    }
  }

  return {
    async correr<T>(clave: string, fn: () => Promise<T>): Promise<T> {
      const anterior = colas.get(clave) ?? Promise.resolve();
      let liberarClave!: () => void;
      const propia = new Promise<void>((resolve) => {
        liberarClave = resolve;
      });
      const cola = anterior.then(() => propia);
      colas.set(clave, cola);

      try {
        await anterior;
        await tomarCupo();
        try {
          return await fn();
        } finally {
          soltarCupo();
        }
      } finally {
        liberarClave();
        if (colas.get(clave) === cola) {
          colas.delete(clave);
        }
      }
    },
    enCurso: () => enCurso,
    esperandoCupo: () => esperandoCupo.length,
  };
}

// El cupo por defecto, derivado del pool de conexiones de Prisma.
//
// Cada turno con el lock ocupa UNA conexión solo por tenerlo, y necesita al
// menos otra para sus consultas; el resto de la API también necesita las
// suyas. La mitad del pool deja la otra mitad libre. Si DATABASE_URL fija
// `connection_limit` se usa ese número; si no, Prisma usa
// `núcleos físicos × 2 + 1`, que Node no puede conocer (solo ve núcleos
// lógicos, y en un contenedor muchas veces los del host), así que se asume el
// pool más chico razonable (5) → 2 turnos. AGENT_TURN_MAX_CONCURRENT lo pisa.
export const CUPO_DE_TURNOS_SIN_CONNECTION_LIMIT = 2;

export function cupoDeTurnosPorDefecto(databaseUrl: string | undefined): number {
  const limite = connectionLimitDe(databaseUrl);
  if (limite === null) {
    return CUPO_DE_TURNOS_SIN_CONNECTION_LIMIT;
  }
  return Math.max(1, Math.floor(limite / 2));
}

function connectionLimitDe(databaseUrl: string | undefined): number | null {
  if (!databaseUrl) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const valor = url.searchParams.get("connection_limit");
  if (valor === null || !/^\d+$/.test(valor)) {
    return null;
  }
  const limite = Number(valor);
  return limite > 0 ? limite : null;
}
