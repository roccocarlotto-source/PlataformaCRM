// ---------------------------------------------------------------------------
// EL TEXTO DEL MODELO, POR ORACIONES YA REVISADAS.
//
// En WhatsApp y web las guardas de salida miran la respuesta completa antes de
// mandarla. Por teléfono no se puede esperar al final: el cliente quedaría en
// silencio. Tampoco se puede soltar cada palabra: lo dicho no se puede
// desdecir. El punto medio es soltar de a oraciones: cada una se libera recién
// cuando todo lo dicho hasta ahí, con ella incluida, pasó las guardas.
//
// Si una oración no pasa, no se dice nada más de esa ronda. Lo que falte lo
// decide el cierre del turno, con las mismas guardas de siempre sobre el texto
// completo: `cerrar` recibe esa respuesta y dice solo la parte que no se dijo.
//
// Un "<" retiene todo lo que sigue: puede ser una etiqueta inventada por el
// modelo, y esas se limpian al cierre.
// ---------------------------------------------------------------------------

// A partir de este largo también se corta en una coma: una oración larga no
// puede demorar la primera palabra.
const LARGO_PARA_CORTAR_EN_COMA = 80;

export interface SalidaPorOraciones {
  // Cada ronda de modelo arranca con la revisión que corresponde a esa ronda.
  empezarRonda(revisar: (acumulado: string) => boolean): void;
  agregar(fragmento: string): void;
  // Devuelve todo lo que se dijo en el turno: es lo que queda guardado.
  cerrar(respuestaFinal: string): string;
  readonly cerrada: boolean;
}

// Dónde termina el próximo tramo que se puede soltar, o -1 si todavía no hay.
export function finDelProximoTramo(texto: string): number {
  if (texto.includes("<")) {
    return -1;
  }
  const oracion = /[.!?…]+["')\]»]*\s/.exec(texto);
  if (oracion) {
    return oracion.index + oracion[0].length;
  }
  if (texto.length >= LARGO_PARA_CORTAR_EN_COMA) {
    const ultima = [...texto.matchAll(/[,;:]\s/g)].at(-1);
    if (ultima) {
      return ultima.index + ultima[0].length;
    }
  }
  return -1;
}

// Lo que queda de `texto` después de `prefijo`, sin contar espacios; null si
// no empieza así (la respuesta final no es la continuación de lo dicho).
export function restoDespuesDe(texto: string, prefijo: string): string | null {
  let i = 0;
  for (const caracter of prefijo) {
    if (/\s/.test(caracter)) {
      continue;
    }
    while (i < texto.length && /\s/.test(texto[i])) {
      i++;
    }
    if (texto[i] !== caracter) {
      return null;
    }
    i++;
  }
  return texto.slice(i);
}

export function crearSalidaPorOraciones(opciones: {
  decir: (texto: string) => void;
  formatear: (texto: string) => string;
}): SalidaPorOraciones {
  const { decir, formatear } = opciones;
  const dichoEnRondasAnteriores: string[] = [];
  let revisar: (acumulado: string) => boolean = () => false;
  let pendiente = "";
  let liberadoDeLaRonda = "";
  let trabada = false;
  let cerrada = false;

  function acumulado(mas: string): string {
    return [...dichoEnRondasAnteriores, liberadoDeLaRonda + mas].join(" ").trim();
  }

  function archivarRonda(): void {
    if (liberadoDeLaRonda.trim().length > 0) {
      dichoEnRondasAnteriores.push(formatear(liberadoDeLaRonda).replace(/\s+/g, " ").trim());
    }
    pendiente = "";
    liberadoDeLaRonda = "";
    trabada = false;
  }

  return {
    get cerrada() {
      return cerrada;
    },

    empezarRonda(revision) {
      archivarRonda();
      revisar = revision;
    },

    agregar(fragmento) {
      if (cerrada) {
        return;
      }
      pendiente += fragmento;
      while (!trabada) {
        const fin = finDelProximoTramo(pendiente);
        if (fin === -1) {
          return;
        }
        const tramo = pendiente.slice(0, fin);
        if (!revisar(acumulado(tramo))) {
          trabada = true;
          return;
        }
        pendiente = pendiente.slice(fin);
        liberadoDeLaRonda += tramo;
        decir(`${formatear(tramo).trim()} `);
      }
    },

    cerrar(respuestaFinal) {
      if (cerrada) {
        return dichoEnRondasAnteriores.join(" ");
      }
      cerrada = true;
      const resto = restoDespuesDe(respuestaFinal, formatear(liberadoDeLaRonda)) ?? respuestaFinal;
      const ultimo = resto.trim();
      if (ultimo.length > 0) {
        decir(ultimo);
        liberadoDeLaRonda += ` ${ultimo}`;
      }
      archivarRonda();
      return dichoEnRondasAnteriores.join(" ");
    },
  };
}
