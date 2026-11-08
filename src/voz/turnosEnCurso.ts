// ---------------------------------------------------------------------------
// UN REINTENTO NO REPITE EL TURNO. Si la plataforma de voz no recibe texto a
// tiempo, vuelve a mandar el mismo pedido. Correrlo de nuevo podría duplicar lo
// que hagan las herramientas, por ejemplo una reserva. Por eso el segundo pedido
// se engancha al turno que ya corre, o repite lo que ese turno dijo.
//
// LO QUE SE REPITE ES SOLO EL TEXTO REAL. Las frases de espera le llegan a quien
// está escuchando en ese momento, pero no se le repiten a quien llega tarde: si
// no, un reintento decía "Sigo con esto..." otra vez.
//
// EN MEMORIA, por proceso: alcanza con una instancia, que es lo que hay. Si el
// proceso se reinicia en medio de un turno, un reintento lo corre de nuevo y lo
// que queda de defensa son las reglas de las herramientas (no dos reservas en el
// mismo horario).
// ---------------------------------------------------------------------------

type Oyente = (texto: string | null) => void;

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
  // Devuelve cómo dejar de escuchar: el turno sigue aunque nadie escuche.
  escuchar(oyente: Oyente): () => void {
    for (const parte of this.partes) {
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
  };
}
