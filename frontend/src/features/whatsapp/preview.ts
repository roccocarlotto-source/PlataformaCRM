// La vista previa de la plantilla de seguimiento (ítem 160): cómo le llega el
// mensaje al cliente. Pura, para probarla sin renderizar.
//
// NO VALIDA. Las reglas del texto (un {nombre} y un {link}, en ese orden, ni
// al principio ni al final) las aplica el backend
// (src/utils/whatsappTemplateText.ts) y su 400 trae el mensaje exacto para
// mostrar; repetirlas acá sería tener dos copias que se desincronizan. La
// pantalla solo las EXPLICA en un texto de ayuda.

export const TOKEN_NOMBRE = "{nombre}";
export const TOKEN_LINK = "{link}";

// Los mismos ejemplos que el backend manda a Meta con el alta.
export const EJEMPLO_NOMBRE = "Ana";
export const EJEMPLO_LINK = "https://g.page/r/ejemplo/review";

export function previewDePlantilla(texto: string): string {
  return texto.trim().split(TOKEN_NOMBRE).join(EJEMPLO_NOMBRE).split(TOKEN_LINK).join(EJEMPLO_LINK);
}

// Inserta un token donde está el cursor (o reemplaza la selección). Devuelve
// el texto nuevo y dónde queda el cursor, justo después del token.
export function insertarToken(
  texto: string,
  token: string,
  seleccion: { inicio: number; fin: number },
): { texto: string; cursor: number } {
  const antes = texto.slice(0, seleccion.inicio);
  const despues = texto.slice(seleccion.fin);
  return { texto: `${antes}${token}${despues}`, cursor: antes.length + token.length };
}
