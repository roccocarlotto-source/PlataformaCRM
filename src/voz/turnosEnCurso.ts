// ---------------------------------------------------------------------------
// UN REINTENTO NO REPITE EL TURNO. Si la plataforma de voz no recibe texto a
// tiempo, vuelve a mandar el mismo pedido. Correrlo de nuevo podría duplicar lo
// que hagan las herramientas, por ejemplo una reserva. Por eso el segundo pedido
// se engancha al turno que ya corre, o repite lo que ese turno dijo.
// También si trae otro texto para el mismo turno (la clave es el número de
// turno, ver claveDelTurno en turnoDeVoz.service.ts): gana el primero.
//
// LO QUE SE REPITE ES SOLO EL TEXTO REAL. Las frases de espera le llegan a quien
// está escuchando en ese momento, pero no se le repiten a quien llega tarde: si
// no, un reintento decía "Sigo con esto..." otra vez.
//
// UNA CONTINUACIÓN NO REPITE LO QUE EL CLIENTE YA ESCUCHÓ. Si el turno tarda,
// la plataforma deja de esperar y vuelve a pedir con lo que ya se dijo como
// último mensaje del asistente (controllers/voz.controller.ts). Ese pedido se
// engancha al mismo turno y recibe solo lo que falta.
//
// EN MEMORIA, por proceso: alcanza con una instancia, que es lo que hay. Si el
// proceso se reinicia en medio de un turno, un reintento lo corre de nuevo y lo
// que queda de defensa son las reglas de las herramientas (no dos reservas en el
// mismo horario).
// ---------------------------------------------------------------------------

type Oyente = (texto: string | null) => void;

// Para comparar lo dicho con lo que la plataforma dice que se dijo: solo letras
// y números, sin mayúsculas, espacios ni signos (la plataforma junta los
// pedazos a su manera).
function comparable(texto: string): string {
  return texto
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export class TurnoEnCurso {
  private readonly partes: string[] = [];
  private readonly oyentes = new Set<Oyente>();
  private terminadoEn: number | null = null;

  get momentoDeFin(): number | null {
    return this.terminadoEn;
  }

  // `esEspera`: una frase de espera, que no se repite a quien llega tarde.
  decir(texto: string, esEspera = false): void {
    if (this.terminadoEn !== null) {
      return;
    }
    if (!esEspera) {
      this.partes.push(texto);
    }
    for (const oyente of this.oyentes) {
      oyente(texto);
    }
  }

  terminar(): void {
    if (this.terminadoEn !== null) {
      return;
    }
    this.terminadoEn = Date.now();
    for (const oyente of this.oyentes) {
      oyente(null);
    }
    this.oyentes.clear();
  }

  // Repite el texto real ya dicho y sigue con lo que venga. `null` avisa el final.
  // `yaEscuchado`: lo que la plataforma ya le dijo al cliente de este turno. Las
  // primeras partes que están ahí, en orden, no se repiten; desde la primera que
  // no está, sale todo. Las frases de espera mezcladas en el medio no molestan.
  // Devuelve cómo dejar de escuchar: el turno sigue aunque nadie escuche.
  escuchar(oyente: Oyente, yaEscuchado = ""): () => void {
    const escuchado = comparable(yaEscuchado);
    let desde = 0;
    let salteando = escuchado.length > 0;
    for (const parte of this.partes) {
      if (salteando) {
        const buscada = comparable(parte);
        const en = escuchado.indexOf(buscada, desde);
        if (en !== -1) {
          desde = en + buscada.length;
          continue;
        }
        salteando = false;
      }
      oyente(parte);
    }
    if (this.terminadoEn !== null) {
      oyente(null);
      return () => undefined;
    }
    this.oyentes.add(oyente);
    return () => {
      this.oyentes.delete(oyente);
    };
  }
}

export const VIDA_DE_UN_TURNO_TERMINADO_MS = 2 * 60 * 1000;

export function crearRegistroDeTurnos(vidaMs = VIDA_DE_UN_TURNO_TERMINADO_MS) {
  const turnos = new Map<string, TurnoEnCurso>();

  function limpiar(): void {
    const ahora = Date.now();
    for (const [clave, turno] of turnos) {
      if (turno.momentoDeFin !== null && ahora - turno.momentoDeFin >= vidaMs) {
        turnos.delete(clave);
      }
    }
  }

  return {
    // `arrancar` corre solo si no había un turno con esa clave.
    obtenerOArrancar(clave: string, arrancar: (turno: TurnoEnCurso) => void): TurnoEnCurso {
      limpiar();
      const existente = turnos.get(clave);
      if (existente) {
        return existente;
      }
      const turno = new TurnoEnCurso();
      turnos.set(clave, turno);
      arrancar(turno);
      return turno;
    },
    // El turno con esa clave, sin arrancar ninguno: para una continuación.
    obtener(clave: string): TurnoEnCurso | null {
      limpiar();
      return turnos.get(clave) ?? null;
    },
  };
}
