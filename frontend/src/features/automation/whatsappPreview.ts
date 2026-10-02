// La vista previa del mensaje de WhatsApp de una regla (el QR y el cupón):
// cómo le llega al cliente. Pura, para probarla sin renderizar. Nació con la
// pantalla de plantillas (ítem 160) y se mudó al formulario de la regla cuando
// la plantilla pasó a armarse sola al guardarla.
//
// NO VALIDA: lo básico lo adelanta validarMensaje (catalog.ts) y el resto de
// las reglas de Meta las aplica el backend (src/utils/whatsappTemplateText.ts),
// cuyo 400 trae el mensaje exacto.

export const TOKEN_NOMBRE = "{nombre}";
export const TOKEN_LINK = "{link}";

// Los mismos ejemplos que el backend manda a Meta con el alta.
export const EJEMPLO_NOMBRE = "Ana";
export const EJEMPLO_LINK = "https://g.page/r/ejemplo/review";

// `link`: el ejemplo de lo que va en {link} (el del cupón no es el del QR).
export function previewDePlantilla(texto: string, link: string = EJEMPLO_LINK): string {
  return texto.trim().split(TOKEN_NOMBRE).join(EJEMPLO_NOMBRE).split(TOKEN_LINK).join(link);
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
