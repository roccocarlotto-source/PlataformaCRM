import {
  conElTermino,
  type TerminoDelContacto,
} from "../../../../src/compartido/guia/terminoDeContacto";

// El término de la organización en la pantalla Ayuda (QA de la primera
// clínica, 2026-11-21). La regla es compartida con el asistente "¿Cómo se
// hace?" (src/compartido/guia/terminoDeContacto.ts); acá solo vive lo que es
// del HTML ya renderizado.
export {
  conElTermino,
  seccionesConElTermino,
} from "../../../../src/compartido/guia/terminoDeContacto";

/** El HTML con el término cambiado solo en el texto, nunca en las etiquetas
 *  (ids, href). */
export function htmlConElTermino(html: string, contacto: TerminoDelContacto | null): string {
  if (!contacto || contacto.singular === "paciente") return html;
  return html.replace(/(^|>)([^<]+)/g, (_, cierre: string, texto: string) => {
    return cierre + conElTermino(texto, contacto);
  });
}
