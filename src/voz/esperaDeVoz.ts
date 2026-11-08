// ---------------------------------------------------------------------------
// LAS FRASES DE ESPERA. La plataforma de voz corta la llamada si el modelo tarda
// demasiado en dar el primer texto, y un silencio largo por teléfono parece una
// llamada caída. Mientras el turno trabaja se manda una frase corta y fija.
//
// Son textos fijos: no pasan por el modelo y no se guardan como respuesta. Van
// terminados en "... " porque así la plataforma sigue esperando lo que viene en
// vez de cerrar la frase con una entonación de final.
//
// LAS REGLAS (pedido de Rocco tras la primera llamada, que repetía "sigo con
// esto, sigo con esto"):
//   - Dos por turno: la primera a los 1,5 s y la segunda a los 5 s
//     del comienzo del turno. Ninguna sale con menos de 3,5 s de silencio desde
//     lo último que se dijo, sea texto real o una frase.
//   - Si en ese momento corre una herramienta, se dice la suya ("Me fijo en el
//     stock..."); si no, una genérica.
//   - Ninguna afirma un resultado ni promete cuánto falta ("te lo dejo
//     anotado", "ya casi lo tengo"): sale mientras la herramienta corre, y la
//     herramienta puede fallar o el dato puede no estar confirmado todavía.
//   - Nunca la misma dos veces en un turno ni una que se dijo en el turno
//     anterior de la llamada. Si no queda ninguna, el turno se queda callado:
//     callar es mejor que repetir.
//
//   - Una tercera a los 8 s, solo si el turno todavía no dijo nada real
//     (pedido de Rocco tras la llamada del 2026-11-08): la plataforma dejaba
//     de esperar unos 4 s después de la segunda frase, y el cliente escuchaba
//     un error en vez de la respuesta. Para llegar a los 8 s, a esta le alcanza
//     con 3 s de silencio.
//
// No hay corte por tiempo acá: abortar a los pocos segundos podría dejar una
// reserva por la mitad. El tope es el presupuesto del turno.
// ---------------------------------------------------------------------------

// Cuándo puede salir cada frase, desde el comienzo del turno.
export const MOMENTOS_DE_LAS_FRASES_MS = [1_500, 5_000, 8_000] as const;
export const MAXIMO_DE_FRASES_POR_TURNO = MOMENTOS_DE_LAS_FRASES_MS.length;
// Silencio mínimo desde lo último que se dijo antes de agregar una frase.
export const SILENCIO_ANTES_DE_UNA_FRASE_MS = 3_500;
export const SILENCIO_ANTES_DE_LA_TERCERA_MS = 3_000;

export const FRASES_GENERICAS = [
  "Dame un segundo... ",
  "Estoy en eso... ",
  "Un momento más... ",
  "Sigo con esto... ",
];

export const FRASES_POR_HERRAMIENTA: Readonly<Record<string, string>> = {
  search_vehicles: "Me fijo en el stock... ",
  get_availability: "Miro la agenda... ",
  create_booking: "Estoy con la agenda... ",
  reschedule_booking: "Estoy con la agenda... ",
  cancel_booking: "Estoy con la agenda... ",
  get_contact_activities: "Reviso lo que tenemos... ",
  update_lead: "Estoy con tus datos... ",
  create_opportunity: "Estoy con tus datos... ",
};

export interface EsperaDeVoz {
  huboTexto(): void;
  empezoHerramienta(nombre: string): void;
  terminoHerramienta(): void;
  parar(): void;
  // Las frases que se dijeron en este turno, en orden.
  dichas(): readonly string[];
}

// La próxima frase, o null si no queda ninguna que se pueda decir.
export function elegirFrase(
  herramienta: string | null,
  prohibidas: ReadonlySet<string>,
): string | null {
  const propia = herramienta ? FRASES_POR_HERRAMIENTA[herramienta] : undefined;
  if (propia && !prohibidas.has(propia)) {
    return propia;
  }
  return FRASES_GENERICAS.find((frase) => !prohibidas.has(frase)) ?? null;
}

// `delTurnoAnterior`: las frases del turno anterior de la misma llamada.
export function crearEsperaDeVoz(opciones: {
  decir: (frase: string) => void;
  delTurnoAnterior: ReadonlySet<string>;
}): EsperaDeVoz {
  const { decir, delTurnoAnterior } = opciones;
  const inicio = Date.now();
  const dichas: string[] = [];
  let ultimaVez: number | null = null;
  let herramienta: string | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let parada = false;
  let huboTextoReal = false;

  function cuandoToca(): number {
    const momento = inicio + MOMENTOS_DE_LAS_FRASES_MS[dichas.length];
    const silencio =
      dichas.length === 2 ? SILENCIO_ANTES_DE_LA_TERCERA_MS : SILENCIO_ANTES_DE_UNA_FRASE_MS;
    return ultimaVez === null ? momento : Math.max(momento, ultimaVez + silencio);
  }

  function programar(): void {
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    if (parada || dichas.length >= MAXIMO_DE_FRASES_POR_TURNO) {
      return;
    }
    // La tercera es solo para un turno que todavía no dijo nada real.
    if (dichas.length === 2 && huboTextoReal) {
      return;
    }
    temporizador = setTimeout(
      () => {
        temporizador = null;
        const frase = elegirFrase(herramienta, new Set([...delTurnoAnterior, ...dichas]));
        if (frase === null) {
          return;
        }
        dichas.push(frase);
        ultimaVez = Date.now();
        decir(frase);
        programar();
      },
      Math.max(0, cuandoToca() - Date.now()),
    );
  }

  programar();

  return {
    huboTexto() {
      huboTextoReal = true;
      ultimaVez = Date.now();
      programar();
    },
    empezoHerramienta(nombre) {
      herramienta = nombre;
    },
    terminoHerramienta() {
      herramienta = null;
    },
    parar() {
      parada = true;
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
    },
    dichas() {
      return dichas;
    },
  };
}
