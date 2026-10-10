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
// Las del seguimiento de una consulta (ítem 185): el saludo entero ("Hola
// Ana", o "Hola" si no hay nombre) y el vehículo que consultó.
export const TOKEN_SALUDO = "{saludo}";
export const TOKEN_VEHICULO = "{vehiculo}";
// R15 (docs/rubros.md §9.1): en una clínica, la prestación que consultó.
export const TOKEN_PRESTACION = "{prestacion}";
// R13: las del recordatorio de turno de una clínica.
export const TOKEN_LUGAR = "{lugar}";
export const TOKEN_DIA = "{dia}";
export const TOKEN_HORA = "{hora}";
export const TOKEN_PROFESIONAL = "{profesional}";

// Los mismos ejemplos que el backend manda a Meta con el alta.
export const EJEMPLO_NOMBRE = "Ana";
export const EJEMPLO_LINK = "https://g.page/r/ejemplo/review";
export const EJEMPLO_SALUDO = "Hola Ana";
export const EJEMPLO_VEHICULO = "Toyota Hilux SRV 2022";
export const EJEMPLO_PRESTACION = "limpieza facial";
export const EJEMPLO_LUGAR = "Clínica Ejemplo (sede Centro)";
export const EJEMPLO_DIA = "lunes 1 de marzo";
export const EJEMPLO_HORA = "10:30";
export const EJEMPLO_PROFESIONAL = "Ana";

// `link`: el ejemplo de lo que va en {link} (el del cupón no es el del QR).
export function previewDePlantilla(texto: string, link: string = EJEMPLO_LINK): string {
  return texto
    .trim()
    .split(TOKEN_NOMBRE)
    .join(EJEMPLO_NOMBRE)
    .split(TOKEN_LINK)
    .join(link)
    .split(TOKEN_SALUDO)
    .join(EJEMPLO_SALUDO)
    .split(TOKEN_VEHICULO)
    .join(EJEMPLO_VEHICULO)
    .split(TOKEN_PRESTACION)
    .join(EJEMPLO_PRESTACION)
    .split(TOKEN_LUGAR)
    .join(EJEMPLO_LUGAR)
    .split(TOKEN_DIA)
    .join(EJEMPLO_DIA)
    .split(TOKEN_HORA)
    .join(EJEMPLO_HORA)
    .split(TOKEN_PROFESIONAL)
    .join(EJEMPLO_PROFESIONAL);
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
