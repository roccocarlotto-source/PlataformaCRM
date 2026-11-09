// ---------------------------------------------------------------------------
// UN REINTENTO NO REPITE EL TURNO. Si la plataforma de voz no recibe texto a
// tiempo, vuelve a mandar el mismo pedido. Correrlo de nuevo podría duplicar lo
// que hagan las herramientas, por ejemplo una reserva. Por eso el segundo pedido
// se engancha al turno que ya corre, o repite lo que ese turno dijo.
// Si trae otro texto para el mismo turno (la clave es el número de turno, ver
// claveDelTurno en turnoDeVoz.service.ts) y el turno todavía no hizo nada, se
// reemplaza (reemplazar, pasarOyentesA); si ya hizo algo, gana el primero.
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

// Quién escucha y a qué turno: si el turno se reemplaza, la suscripción pasa
// al nuevo y dejar de escuchar sigue andando.
interface Suscripcion {
  oyente: Oyente;
  turno: TurnoEnCurso;
}

// Para comparar lo dicho con lo que la plataforma dice que se dijo: solo letras
// y números, sin mayúsculas, acentos, espacios ni signos (la plataforma junta
// los pedazos a su manera, y el reconocimiento de voz pone o saca acentos).
export function comparable(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export class TurnoEnCurso {
  private readonly partes: string[] = [];
  private readonly suscripciones = new Set<Suscripcion>();
  private terminadoEn: number | null = null;

  get momentoDeFin(): number | null {
    return this.terminadoEn;
  }

  // Si ya le dijo algo real al cliente (las frases de espera no cuentan).
  get dijoAlgo(): boolean {
    return this.partes.length > 0;
  }

  // Los que escuchan este turno pasan a escuchar `otro`. Para un turno que se
  // reemplaza antes de decir nada real: no hay nada que repetirles.
  pasarOyentesA(otro: TurnoEnCurso): void {
    for (const suscripcion of this.suscripciones) {
      suscripcion.turno = otro;
      otro.suscripciones.add(suscripcion);
    }
    this.suscripciones.clear();
  }

  // `esEspera`: una frase de espera, que no se repite a quien llega tarde.
  decir(texto: string, esEspera = false): void {
    if (this.terminadoEn !== null) {
      return;
    }
    if (!esEspera) {
      this.partes.push(texto);
    }
    for (const { oyente } of this.suscripciones) {
      oyente(texto);
    }
  }

  terminar(): void {
    if (this.terminadoEn !== null) {
      return;
    }
    this.terminadoEn = Date.now();
    for (const { oyente } of this.suscripciones) {
      oyente(null);
    }
    this.suscripciones.clear();
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
    const suscripcion: Suscripcion = { oyente, turno: this };
    this.suscripciones.add(suscripcion);
    return () => {
      suscripcion.turno.suscripciones.delete(suscripcion);
    };
  }
}

export const VIDA_DE_UN_TURNO_TERMINADO_MS = 2 * 60 * 1000;

// Los turnos de una clave (un número de turno de una llamada), en orden: el
// último es el vigente. Hay más de uno cuando llegó la frase más larga después
// de que el primero ya había hecho algo (un turno de seguimiento,
// turnoDeVoz.service.ts).
export function crearRegistroDeTurnos(vidaMs = VIDA_DE_UN_TURNO_TERMINADO_MS) {
  const turnos = new Map<string, TurnoEnCurso[]>();

  function limpiar(): void {
    const ahora = Date.now();
    for (const [clave, lista] of turnos) {
      const fin = lista.at(-1)?.momentoDeFin ?? null;
      if (fin !== null && ahora - fin >= vidaMs) {
        turnos.delete(clave);
      }
    }
  }

  function nuevo(arrancar: (turno: TurnoEnCurso) => void, lista: TurnoEnCurso[]): TurnoEnCurso {
    const turno = new TurnoEnCurso();
    lista.push(turno);
    arrancar(turno);
    return turno;
  }

  return {
    // `arrancar` corre solo si no había un turno con esa clave.
    obtenerOArrancar(clave: string, arrancar: (turno: TurnoEnCurso) => void): TurnoEnCurso {
      limpiar();
      const existente = turnos.get(clave)?.at(-1);
      if (existente) {
        return existente;
      }
      const lista: TurnoEnCurso[] = [];
      turnos.set(clave, lista);
      return nuevo(arrancar, lista);
    },
    // Arranca otro turno con esa clave en lugar del vigente (que se canceló).
    reemplazar(clave: string, arrancar: (turno: TurnoEnCurso) => void): TurnoEnCurso {
      const lista = turnos.get(clave) ?? [];
      lista.pop();
      turnos.set(clave, lista);
      return nuevo(arrancar, lista);
    },
    // Arranca otro turno con esa clave después del vigente, que sigue el suyo.
    agregar(clave: string, arrancar: (turno: TurnoEnCurso) => void): TurnoEnCurso {
      const lista = turnos.get(clave) ?? [];
      turnos.set(clave, lista);
      return nuevo(arrancar, lista);
    },
    // El turno vigente de esa clave, sin arrancar ninguno: para una continuación.
    obtener(clave: string): TurnoEnCurso | null {
      limpiar();
      return turnos.get(clave)?.at(-1) ?? null;
    },
    // Todos los turnos de esa clave, del primero al vigente.
    todos(clave: string): readonly TurnoEnCurso[] {
      limpiar();
      return turnos.get(clave) ?? [];
    },
  };
}

// Lo que `completo` agrega a `dicho`, si empieza igual (comparando solo letras
// y números: el reconocimiento de voz cambia signos y mayúsculas entre un
// pedido y otro). Si no empieza igual o no agrega nada, `completo` entero.
// "Te paso mi teléfono" + "Te paso mi teléfono: 096468788" → "096468788".
export function loQueFalta(dicho: string, completo: string): string {
  const buscado = comparable(dicho);
  let i = 0;
  let corte = -1;
  for (let j = 0; j < completo.length && i < buscado.length; j++) {
    const caracter = comparable(completo[j]);
    if (caracter.length === 0) {
      continue;
    }
    if (!buscado.startsWith(caracter, i)) {
      return completo.trim();
    }
    i += caracter.length;
    if (i === buscado.length) {
      corte = j + 1;
    }
  }
  if (corte === -1) {
    return completo.trim();
  }
  const resto = completo
    .slice(corte)
    .replace(/^[\s\p{P}]+/u, "")
    .trim();
  return resto.length > 0 ? resto : completo.trim();
}
