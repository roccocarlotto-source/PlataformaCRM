import { asignarAnclas, type Seccion } from "./guia";

// ---------------------------------------------------------------------------
// La guía de clínicas está escrita con "paciente" (el término por defecto del
// rubro). Una clínica que eligió otro término en Organización (un centro de
// belleza: "cliente") lo ve también en la Ayuda y en las respuestas de "¿Cómo
// se hace?" (QA de la primera clínica, 2026-11-21).
//
// Compartido entre el frontend (la pantalla Ayuda, que cambia el HTML ya
// renderizado) y el backend (el asistente, que le pasa el markdown al
// modelo). En los dos, las ANCLAS no cambian: salen del texto original, así
// que los "?" de cada pantalla y los links siguen apuntando a lo mismo. Todas
// las apariciones de la guía son masculinas ("el paciente", "los
// pacientes"), igual que "cliente": no hay concordancia que ajustar.
// ---------------------------------------------------------------------------

/** El término con que la organización nombra a sus contactos. */
export interface TerminoDelContacto {
  singular: string;
  plural: string;
}

const PACIENTE = /\b([Pp])aciente(s?)\b/g;

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function cambia(contacto: TerminoDelContacto | null): contacto is TerminoDelContacto {
  return contacto !== null && contacto.singular !== "paciente";
}

/** El texto con "paciente(s)" cambiado por el término de la organización.
 *  Sin término (una automotora) o con "paciente", igual. */
export function conElTermino(texto: string, contacto: TerminoDelContacto | null): string {
  if (!cambia(contacto)) return texto;
  return texto.replace(PACIENTE, (_, inicial: string, plural: string) => {
    const palabra = plural ? contacto.plural : contacto.singular;
    return inicial === "P" ? mayuscula(palabra) : palabra;
  });
}

// Lo que no se toca dentro de una línea de markdown: el `{#ancla}` de un
// encabezado, el destino de un link `](/ayuda/x#unir-pacientes)` y el código
// en línea.
const NO_SE_TOCA = /(\{#[^}]*\}|\]\([^)]*\)|`[^`]*`)/;

/** El markdown con el término cambiado solo en lo que se lee. Primero fija
 *  todas las anclas (asignarAnclas): un "### Ficha del paciente" sin ancla
 *  explícita conserva `#ficha-del-paciente` aunque el texto diga "cliente".
 *  Los bloques de código no se tocan. */
export function markdownConElTermino(
  markdown: string,
  contacto: TerminoDelContacto | null,
): string {
  if (!cambia(contacto)) return markdown;
  let enBloqueDeCodigo = false;
  return asignarAnclas(markdown)
    .split("\n")
    .map((linea) => {
      if (linea.startsWith("```")) {
        enBloqueDeCodigo = !enBloqueDeCodigo;
        return linea;
      }
      if (enBloqueDeCodigo) return linea;
      return linea
        .split(NO_SE_TOCA)
        .map((parte, i) => (i % 2 === 1 ? parte : conElTermino(parte, contacto)))
        .join("");
    })
    .join("\n");
}

/** Las secciones con los títulos (de la sección y de cada encabezado) en el
 *  término de la organización. Con `markdown: true` (el asistente), también el
 *  texto; sin él (la pantalla Ayuda, que cambia el HTML), el markdown queda
 *  igual. Las anclas no cambian nunca. */
export function seccionesConElTermino(
  secciones: Seccion[],
  contacto: TerminoDelContacto | null,
  opciones: { markdown?: boolean } = {},
): Seccion[] {
  if (!cambia(contacto)) return secciones;
  return secciones.map((seccion) => ({
    ...seccion,
    titulo: conElTermino(seccion.titulo, contacto),
    markdown: opciones.markdown
      ? markdownConElTermino(seccion.markdown, contacto)
      : seccion.markdown,
    encabezados: seccion.encabezados.map((e) => ({
      ...e,
      titulo: conElTermino(e.titulo, contacto),
    })),
  }));
}
