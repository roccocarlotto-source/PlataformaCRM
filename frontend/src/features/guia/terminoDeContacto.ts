import type { Termino } from "../../auth/vocabulario";
import type { Seccion } from "./secciones";

// ---------------------------------------------------------------------------
// La guía de clínicas está escrita con "paciente" (el término por defecto del
// rubro). Una clínica que eligió otro término en Organización (un centro de
// belleza: "cliente") lo ve también en la Ayuda (QA de la primera clínica,
// 2026-11-21: el menú decía "Clientes" y la Ayuda, "Pacientes").
//
// Se cambia solo lo que se lee: el texto del HTML ya renderizado (fuera de las
// etiquetas) y los títulos del índice. Las anclas salen del markdown original,
// así que los "?" de cada pantalla y los links siguen apuntando a lo mismo.
// Todas las apariciones de la guía son masculinas ("el paciente", "los
// pacientes"), igual que "cliente": no hay concordancia que ajustar.
// ---------------------------------------------------------------------------

const PACIENTE = /\b([Pp])aciente(s?)\b/g;

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** El texto con "paciente(s)" cambiado por el término de la organización.
 *  Sin término (una automotora), igual. */
export function conElTermino(texto: string, contacto: Termino | null): string {
  if (!contacto || contacto.singular === "paciente") return texto;
  return texto.replace(PACIENTE, (_, inicial: string, plural: string) => {
    const palabra = plural ? contacto.plural : contacto.singular;
    return inicial === "P" ? mayuscula(palabra) : palabra;
  });
}

/** El HTML con el término cambiado solo en el texto, nunca en las etiquetas
 *  (ids, href). */
export function htmlConElTermino(html: string, contacto: Termino | null): string {
  if (!contacto || contacto.singular === "paciente") return html;
  return html.replace(/(^|>)([^<]+)/g, (_, cierre: string, texto: string) => {
    return cierre + conElTermino(texto, contacto);
  });
}

/** Las secciones con los títulos (de la sección y de cada encabezado) en el
 *  término de la organización; el markdown y las anclas no cambian. */
export function seccionesConElTermino(secciones: Seccion[], contacto: Termino | null): Seccion[] {
  if (!contacto || contacto.singular === "paciente") return secciones;
  return secciones.map((seccion) => ({
    ...seccion,
    titulo: conElTermino(seccion.titulo, contacto),
    encabezados: seccion.encabezados.map((e) => ({
      ...e,
      titulo: conElTermino(e.titulo, contacto),
    })),
  }));
}
