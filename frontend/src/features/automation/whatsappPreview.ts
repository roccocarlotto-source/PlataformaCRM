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
// R14: el control después del turno.
export const TOKEN_SEMANAS = "{semanas}";
// S7 (docs/servicios.md §6.4): la fecha del próximo service.
export const TOKEN_FECHA = "{fecha}";

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
export const EJEMPLO_SEMANAS = "4";
// S7: los ejemplos del recordatorio del próximo service.
export const EJEMPLO_FECHA = "el 15 de noviembre";
export const EJEMPLO_LUGAR_DEL_TALLER = "Automotores del Sur";
export const EJEMPLO_VEHICULO_DEL_TALLER = "Volkswagen Gol (ABC 1234)";

// `link`: el ejemplo de lo que va en {link} (el del cupón no es el del QR).
// `ejemplos`: otro {lugar} o {vehiculo} (S7: los de un taller, no los de una
// clínica ni los de una consulta).
export function previewDePlantilla(
  texto: string,
  link: string = EJEMPLO_LINK,
  ejemplos: { lugar?: string; vehiculo?: string } = {},
): string {
  return texto
    .trim()
    .split(TOKEN_NOMBRE)
    .join(EJEMPLO_NOMBRE)
    .split(TOKEN_LINK)
    .join(link)
    .split(TOKEN_SALUDO)
    .join(EJEMPLO_SALUDO)
    .split(TOKEN_VEHICULO)
    .join(ejemplos.vehiculo ?? EJEMPLO_VEHICULO)
    .split(TOKEN_PRESTACION)
    .join(EJEMPLO_PRESTACION)
    .split(TOKEN_LUGAR)
    .join(ejemplos.lugar ?? EJEMPLO_LUGAR)
    .split(TOKEN_DIA)
    .join(EJEMPLO_DIA)
    .split(TOKEN_HORA)
    .join(EJEMPLO_HORA)
    .split(TOKEN_PROFESIONAL)
    .join(EJEMPLO_PROFESIONAL)
    .split(TOKEN_SEMANAS)
    .join(EJEMPLO_SEMANAS)
    .split(TOKEN_FECHA)
    .join(EJEMPLO_FECHA);
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
