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

// ---------------------------------------------------------------------------
// UN TOPE POR ORGANIZACIÓN DENTRO DEL CUPO GLOBAL (FABLE-G-03 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// El cupo es de todo el proceso: lo comparten los turnos del widget, los de
// WhatsApp/Messenger/Instagram y las respuestas de una persona desde el CRM,
// de TODAS las organizaciones. Con solo el cupo global, una organización con
// turnos lentos —el proveedor que tarda, o alguien abusando de su widget
// público— podía ocupar todos los lugares, y los clientes de las demás
// esperaban detrás.
//
// Ahora quien llama puede decir de qué GRUPO es el turno (la organización), y
// un grupo nunca ocupa más de `maximoPorGrupo` lugares a la vez. Por defecto
// es el cupo menos uno: siempre queda al menos un lugar que esa organización
// no puede tomar. Con un cupo de 1 no hay nada que repartir y el tope no
// aplica (es 1).
//
// Los que esperan siguen en orden de llegada, con una salvedad que es el
// sentido del cambio: si el primero de la fila es de un grupo que está en su
// tope, pasa el siguiente que sí pueda entrar. Un turno sin grupo solo mira el
// cupo global, como antes.
// ---------------------------------------------------------------------------
export function maximoPorGrupoPorDefecto(maximo: number): number {
  return Math.max(1, maximo - 1);
}

export interface LimitadorDeTurnos {
  correr<T>(clave: string, fn: () => Promise<T>, grupo?: string): Promise<T>;
  enCurso(): number;
  esperandoCupo(): number;
}

export function crearLimitadorDeTurnos(
  maximo: number,
  maximoPorGrupo: number = maximoPorGrupoPorDefecto(maximo),
): LimitadorDeTurnos {
  if (!Number.isInteger(maximo) || maximo < 1) {
    throw new Error(`El cupo de turnos tiene que ser un entero positivo (vino ${maximo})`);
  }
  if (!Number.isInteger(maximoPorGrupo) || maximoPorGrupo < 1) {
    throw new Error(
      `El tope de turnos por organización tiene que ser un entero positivo (vino ${maximoPorGrupo})`,
    );
  }

  const colas = new Map<string, Promise<void>>();
  let enCurso = 0;
  const enCursoPorGrupo = new Map<string, number>();
  const esperandoCupo: Array<{ grupo: string | undefined; entrar: () => void }> = [];

  function puedeEntrar(grupo: string | undefined): boolean {
    if (enCurso >= maximo) {
      return false;
    }
    return grupo === undefined || (enCursoPorGrupo.get(grupo) ?? 0) < maximoPorGrupo;
  }

  function ocupar(grupo: string | undefined): void {
    enCurso++;
    if (grupo !== undefined) {
      enCursoPorGrupo.set(grupo, (enCursoPorGrupo.get(grupo) ?? 0) + 1);
    }
  }

  async function tomarCupo(grupo: string | undefined): Promise<void> {
    if (puedeEntrar(grupo)) {
      ocupar(grupo);
      return;
    }
    await new Promise<void>((resolve) => esperandoCupo.push({ grupo, entrar: resolve }));
  }

  function soltarCupo(grupo: string | undefined): void {
    enCurso--;
    if (grupo !== undefined) {
      const quedan = (enCursoPorGrupo.get(grupo) ?? 1) - 1;
      if (quedan <= 0) {
        enCursoPorGrupo.delete(grupo);
      } else {
        enCursoPorGrupo.set(grupo, quedan);
      }
    }
    // Entra el primero de la fila que pueda: el lugar ya queda ocupado a su
    // nombre antes de despertarlo, para que nadie se lo saque en el medio.
    for (let i = 0; i < esperandoCupo.length && enCurso < maximo;) {
      const candidato = esperandoCupo[i]!;
      if (puedeEntrar(candidato.grupo)) {
        esperandoCupo.splice(i, 1);
        ocupar(candidato.grupo);
        candidato.entrar();
      } else {
        i++;
      }
    }
  }

  return {
    async correr<T>(clave: string, fn: () => Promise<T>, grupo?: string): Promise<T> {
      const anterior = colas.get(clave) ?? Promise.resolve();
      let liberarClave!: () => void;
      const propia = new Promise<void>((resolve) => {
        liberarClave = resolve;
      });
      const cola = anterior.then(() => propia);
      colas.set(clave, cola);

      try {
        await anterior;
        await tomarCupo(grupo);
        try {
          return await fn();
        } finally {
          soltarCupo(grupo);
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
