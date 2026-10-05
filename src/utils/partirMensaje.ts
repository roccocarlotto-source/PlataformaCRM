import type { ConversationChannel } from "@prisma/client";

// ---------------------------------------------------------------------------
// Tope de largo por canal, y cómo se parte un mensaje que lo supera (OPUS-B-02
// de docs-privados/auditoria-2026-10-04-OPUS.md y FABLE-B-05 de
// docs-privados/auditoria-2026-10-05-FABLE.md, locales).
//
// Antes el texto salía entero por cualquier canal. Una respuesta larga —el
// resultado de una búsqueda con varias unidades— Meta la rechazaba en
// Messenger o Instagram, el envío quedaba fallido para siempre y el cliente no
// recibía nada, justo en la consulta más común. Ahora un mensaje más largo que
// el tope de su canal sale en varios mensajes seguidos.
//
// LOS TOPES, verificados contra la documentación de Meta el 05/10/2026:
//   - WhatsApp: el cuerpo de un texto admite hasta 4096 caracteres.
//   - Messenger: "must be UTF-8 and less than 2000 characters".
//   - Instagram: "must be UTF-8 and be 1,000 bytes or less". Son BYTES: una
//     "á" ocupa dos y un emoji cuatro, así que ahí se mide en bytes.
// Messenger e Instagram llevan margen: quedarse 100 por debajo no le cambia
// nada al cliente y evita depender de cómo cuenta Meta un caso borde.
// Web no tiene tope: el widget lee el hilo de la base.
// ---------------------------------------------------------------------------

interface Tope {
  maximo: number;
  unidad: "caracteres" | "bytes";
}

export const TOPE_DE_LARGO_POR_CANAL: Record<ConversationChannel, Tope | null> = {
  WHATSAPP: { maximo: 4096, unidad: "caracteres" },
  MESSENGER: { maximo: 1900, unidad: "caracteres" },
  INSTAGRAM: { maximo: 950, unidad: "bytes" },
  WEB: null,
};

function medir(texto: string, unidad: Tope["unidad"]): number {
  return unidad === "bytes" ? Buffer.byteLength(texto, "utf8") : texto.length;
}

// El prefijo más largo de `texto` que entra en el tope, sin cortar un
// carácter por la mitad (se avanza de a code points: un emoji son dos
// unidades de un string y cuatro bytes).
function prefijoQueEntra(texto: string, tope: Tope): number {
  let usado = 0;
  let indice = 0;
  for (const caracter of texto) {
    const costo = medir(caracter, tope.unidad);
    if (usado + costo > tope.maximo) {
      break;
    }
    usado += costo;
    indice += caracter.length;
  }
  return indice;
}

// Dónde cortar dentro del prefijo: en el corte más natural que haya, de mayor
// a menor —un párrafo, un renglón, el final de una oración, un espacio—, y
// solo si no deja un primer pedazo ridículamente corto. Si no hay ninguno (una
// URL larguísima, un texto sin espacios), se corta donde entra.
const CORTES: readonly RegExp[] = [/\n\s*\n/g, /\n/g, /[.!?…]\s/g, /\s/g];

function puntoDeCorte(prefijo: string): number {
  const minimo = Math.floor(prefijo.length * 0.4);
  for (const corte of CORTES) {
    let ultimo = -1;
    for (const m of prefijo.matchAll(corte)) {
      // El signo de cierre de la oración queda con su oración.
      ultimo = m.index + (/^[.!?…]/.test(m[0]) ? 1 : 0);
    }
    if (ultimo >= minimo) {
      return ultimo;
    }
  }
  return prefijo.length;
}

// Las partes en las que sale `texto` por `canal`, en orden. Un texto que entra
// en el tope (o un canal sin tope) es una sola parte, sin tocar. Cada parte es
// un pedazo literal del texto original: solo se le sacan los espacios de los
// bordes del corte.
export function partirMensaje(texto: string, canal: ConversationChannel): string[] {
  const tope = TOPE_DE_LARGO_POR_CANAL[canal];
  if (tope === null || medir(texto, tope.unidad) <= tope.maximo) {
    return [texto];
  }
  const partes: string[] = [];
  let resto = texto.trim();
  while (medir(resto, tope.unidad) > tope.maximo) {
    const prefijo = resto.slice(0, prefijoQueEntra(resto, tope));
    const corte = puntoDeCorte(prefijo);
    partes.push(prefijo.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto.length > 0) {
    partes.push(resto);
  }
  return partes;
}
