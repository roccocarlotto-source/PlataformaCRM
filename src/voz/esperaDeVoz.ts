// ---------------------------------------------------------------------------
// LAS FRASES DE ESPERA. La plataforma de voz corta la llamada si el modelo tarda
// demasiado en dar el primer texto, y un silencio largo por teléfono parece una
// llamada caída. Mientras el turno trabaja se manda una frase corta y fija.
//
// Son textos fijos: no pasan por el modelo y no se guardan como respuesta. Van
// terminados en "... " porque así la plataforma sigue esperando lo que viene en
// vez de cerrar la frase con una entonación de final.
//
// No hay corte por tiempo acá: abortar a los pocos segundos podría dejar una
// reserva por la mitad. El tope es el presupuesto del turno.
// ---------------------------------------------------------------------------

export const DEMORA_DE_LA_PRIMERA_FRASE_MS = 1_200;
export const DEMORA_POR_HERRAMIENTA_MS = 600;
export const SILENCIO_ENTRE_FRASES_MS = 3_000;
// Una frase de herramienta no sale pegada a lo último que se dijo.
export const SEPARACION_MINIMA_MS = 1_500;

export const FRASES_GENERICAS = [
  "Dame un segundo... ",
  "Ya casi lo tengo... ",
  "Un momento más... ",
  "Sigo con esto... ",
];

export const FRASES_POR_HERRAMIENTA: Readonly<Record<string, string>> = {
  search_vehicles: "Me fijo en el stock... ",
  get_availability: "Miro la agenda... ",
  create_booking: "Te lo dejo agendado... ",
  reschedule_booking: "Te lo cambio en la agenda... ",
  cancel_booking: "Lo cancelo en la agenda... ",
  get_contact_activities: "Reviso lo que tenemos... ",
  update_lead: "Te lo dejo anotado... ",
  create_opportunity: "Te lo dejo anotado... ",
};

export interface EsperaDeVoz {
  huboTexto(): void;
  empezoHerramienta(nombre: string): void;
  terminoHerramienta(): void;
  parar(): void;
}

// `usadas` es de la llamada: una frase no se repite mientras queden otras.
export function crearEsperaDeVoz(opciones: {
  decir: (frase: string) => void;
  usadas: Set<string>;
}): EsperaDeVoz {
  const { decir, usadas } = opciones;
  const inicio = Date.now();
  let ultimaVez: number | null = null;
  let herramienta: { nombre: string; desde: number } | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let parada = false;

  function elegirFrase(): string {
    const propia = herramienta ? FRASES_POR_HERRAMIENTA[herramienta.nombre] : undefined;
    if (propia && !usadas.has(propia)) {
      return propia;
    }
    const libre = FRASES_GENERICAS.find((frase) => !usadas.has(frase));
    if (libre) {
      return libre;
    }
    // Se usaron todas: se vuelve a empezar, sin repetir la última.
    const ultima = [...usadas].at(-1);
    usadas.clear();
    return FRASES_GENERICAS.find((frase) => frase !== ultima) ?? FRASES_GENERICAS[0];
  }

  function cuandoToca(): number {
    if (herramienta) {
      const porHerramienta = herramienta.desde + DEMORA_POR_HERRAMIENTA_MS;
      return ultimaVez === null
        ? porHerramienta
        : Math.max(porHerramienta, ultimaVez + SEPARACION_MINIMA_MS);
    }
    return ultimaVez === null
      ? inicio + DEMORA_DE_LA_PRIMERA_FRASE_MS
      : ultimaVez + SILENCIO_ENTRE_FRASES_MS;
  }

  function programar(): void {
    if (temporizador) {
      clearTimeout(temporizador);
    }
    if (parada) {
      return;
    }
    temporizador = setTimeout(
      () => {
        const frase = elegirFrase();
        usadas.add(frase);
        ultimaVez = Date.now();
        herramienta = null;
        decir(frase);
        programar();
      },
      Math.max(0, cuandoToca() - Date.now()),
    );
  }

  programar();

  return {
    huboTexto() {
      ultimaVez = Date.now();
      programar();
    },
    empezoHerramienta(nombre) {
      herramienta = { nombre, desde: Date.now() };
      programar();
    },
    terminoHerramienta() {
      herramienta = null;
      programar();
    },
    parar() {
      parada = true;
      if (temporizador) {
        clearTimeout(temporizador);
      }
    },
  };
}
