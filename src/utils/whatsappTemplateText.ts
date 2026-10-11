// ---------------------------------------------------------------------------
// El texto de las plantillas de WhatsApp que mandan las automatizaciones
// (ítem 160 de docs/frontend-cambios-pendientes.md; con variables por acción
// desde el ítem 185): validación y traducción al formato de Meta. Pura, sin
// base ni red.
//
// EL NEGOCIO NO ESCRIBE {{1}}/{{2}}. Escribe texto libre alrededor de tokens
// con nombre y esto los traduce. Cada ACCIÓN declara sus variables
// (VariableDePlantilla): el seguimiento con QR y el cupón usan {nombre} y
// {link}; el seguimiento de una consulta (ítem 185) usa {saludo} y
// {vehiculo}. Las reglas son las de Meta más una propia:
//
//   - cada variable REQUERIDA exactamente una vez, cada OPCIONAL a lo sumo
//     una vez: el worker manda los parámetros de las que están, ni más ni
//     menos (con otro número de variables Meta rechaza el envío con #132000);
//   - en el ORDEN en que la acción las declara: Meta numera las variables por
//     orden de aparición, y el worker manda los parámetros en ese mismo
//     orden posicional. Al revés, el cliente recibiría el link donde va su
//     nombre;
//   - ninguna variable al principio ni al final del texto (regla de Meta:
//     rechaza la plantilla en la revisión);
//   - ningún otro {…} ni {{/}}: la regla propia. "{Nombre}" o "{link }" son
//     casi siempre un error de tipeo que, sin esto, Meta aprobaría como texto
//     literal y el cliente recibiría con las llaves;
//   - el cuerpo que viaja, a lo sumo 1024 caracteres (tope de Meta).
//
// Los mensajes de error son para el negocio, en castellano: el controller los
// devuelve tal cual en el 400 y la pantalla los muestra.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Formato del mensaje (la regla lo elige): solo el link en el texto, solo la
// imagen del QR como encabezado, o las dos cosas. "Ambos" lleva el link en el
// TEXTO y no en un botón: es lo más simple que Meta aprueba (un botón de URL
// dinámica exige un prefijo fijo de dominio por plantilla) y es exactamente
// lo que ya mandaban las reglas existentes.
// ---------------------------------------------------------------------------
export const FORMATOS_DE_MENSAJE = ["LINK", "IMAGE", "LINK_AND_IMAGE"] as const;
export type FormatoDeMensaje = (typeof FORMATOS_DE_MENSAJE)[number];

// El de toda regla guardada antes de que existiera la elección.
export const FORMATO_POR_DEFECTO: FormatoDeMensaje = "LINK";

export function formatoLlevaLink(formato: FormatoDeMensaje): boolean {
  return formato !== "IMAGE";
}

export function formatoLlevaImagen(formato: FormatoDeMensaje): boolean {
  return formato !== "LINK";
}

export const TOKEN_NOMBRE = "{nombre}";
export const TOKEN_LINK = "{link}";
// Ítem 185: el saludo entero ("Hola Ana", o "Hola" a secas si no hay un
// nombre real) y el vehículo que consultó (o un texto genérico). Es el saludo
// y no el nombre porque Meta no acepta un parámetro vacío: con {nombre} no
// habría forma de saludar sin nombre a quien no lo dio.
export const TOKEN_SALUDO = "{saludo}";
export const TOKEN_VEHICULO = "{vehiculo}";
// R15 (docs/rubros.md §9.1): en una clínica, la prestación que consultó (o
// "lo que consultaste"), en lugar del vehículo. Solo la acepta una clínica.
export const TOKEN_PRESTACION = "{prestacion}";
// R13 (docs/rubros.md §6.3): el recordatorio de un turno de clínica. {lugar}
// lo arma el backend (la clínica, o "Clínica X (sede Y)" con más de una sede).
// Sin la prestación: es un dato de salud en la pantalla del teléfono.
export const TOKEN_LUGAR = "{lugar}";
export const TOKEN_DIA = "{dia}";
export const TOKEN_HORA = "{hora}";
export const TOKEN_PROFESIONAL = "{profesional}";
// R14 (docs/rubros.md §7.2): el control, "ya pasaron {semanas} semanas".
export const TOKEN_SEMANAS = "{semanas}";

// Tope del cuerpo de una plantilla en Meta, medido sobre el texto que viaja.
export const LARGO_MAXIMO_DEL_CUERPO = 1024;

// Los valores de ejemplo que Meta exige en el alta de una plantilla con
// variables (los mira quien la revisa). Los mismos del ítem 159.
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

export interface VariableDePlantilla {
  token: string;
  requerida: boolean;
  ejemplo: string;
}

export const VARIABLE_NOMBRE: VariableDePlantilla = {
  token: TOKEN_NOMBRE,
  requerida: true,
  ejemplo: EJEMPLO_NOMBRE,
};
export const VARIABLE_LINK: VariableDePlantilla = {
  token: TOKEN_LINK,
  requerida: true,
  ejemplo: EJEMPLO_LINK,
};

// Las del seguimiento con QR y el cupón: {nombre} siempre; {link} solo si el
// formato lo lleva (y entonces es obligatorio).
export function variablesDeSeguimiento(conLink: boolean): VariableDePlantilla[] {
  return conLink ? [VARIABLE_NOMBRE, VARIABLE_LINK] : [VARIABLE_NOMBRE];
}

// Las del seguimiento de una consulta (ítem 185): el saludo obligatorio, el
// vehículo opcional.
export const VARIABLES_DE_CONSULTA: readonly VariableDePlantilla[] = [
  { token: TOKEN_SALUDO, requerida: true, ejemplo: EJEMPLO_SALUDO },
  { token: TOKEN_VEHICULO, requerida: false, ejemplo: EJEMPLO_VEHICULO },
];

// R15: las de una clínica, con la prestación en lugar del vehículo.
export const VARIABLES_DE_CONSULTA_DE_CLINICA: readonly VariableDePlantilla[] = [
  { token: TOKEN_SALUDO, requerida: true, ejemplo: EJEMPLO_SALUDO },
  { token: TOKEN_PRESTACION, requerida: false, ejemplo: EJEMPLO_PRESTACION },
];

// R13: las del recordatorio de turno, en este orden. {nombre}, {dia} y
// {hora} obligatorias; {lugar} y {profesional}, opcionales.
export const VARIABLES_DE_RECORDATORIO: readonly VariableDePlantilla[] = [
  { token: TOKEN_NOMBRE, requerida: true, ejemplo: EJEMPLO_NOMBRE },
  { token: TOKEN_LUGAR, requerida: false, ejemplo: EJEMPLO_LUGAR },
  { token: TOKEN_DIA, requerida: true, ejemplo: EJEMPLO_DIA },
  { token: TOKEN_HORA, requerida: true, ejemplo: EJEMPLO_HORA },
  { token: TOKEN_PROFESIONAL, requerida: false, ejemplo: EJEMPLO_PROFESIONAL },
];

// R14: las del control después del turno. {nombre} obligatoria; {semanas} y
// {lugar}, opcionales. Sin la prestación.
export const VARIABLES_DE_CONTROL: readonly VariableDePlantilla[] = [
  { token: TOKEN_NOMBRE, requerida: true, ejemplo: EJEMPLO_NOMBRE },
  { token: TOKEN_SEMANAS, requerida: false, ejemplo: EJEMPLO_SEMANAS },
  { token: TOKEN_LUGAR, requerida: false, ejemplo: EJEMPLO_LUGAR },
];

// La familia de {nombre} y {link} (el QR y el cupón): sus mensajes de error
// hablan del link aunque el formato no lo lleve.
function esFamiliaDelNombre(variables: readonly VariableDePlantilla[]): boolean {
  return (
    variables.some((v) => v.token === TOKEN_NOMBRE) &&
    variables.every((v) => v.token === TOKEN_NOMBRE || v.token === TOKEN_LINK)
  );
}

// Todos los tokens que el sistema traduce, para numerarlos por aparición.
const TODOS_LOS_TOKENS: readonly string[] = [
  TOKEN_NOMBRE,
  TOKEN_LINK,
  TOKEN_SALUDO,
  TOKEN_VEHICULO,
  TOKEN_PRESTACION,
  TOKEN_LUGAR,
  TOKEN_DIA,
  TOKEN_HORA,
  TOKEN_PROFESIONAL,
  TOKEN_SEMANAS,
];

function contar(texto: string, token: string): number {
  return texto.split(token).length - 1;
}

// Cómo se nombran las variables permitidas en los mensajes de error. Para la
// familia de {nombre} se dice siempre "{nombre} y {link}", aunque el formato
// no lleve link: el negocio puede tener el link escrito y el mensaje
// siguiente ("sacá {link}") es el que lo guía.
function descripcionDeVariables(variables: readonly VariableDePlantilla[]): string {
  if (esFamiliaDelNombre(variables)) {
    return `${TOKEN_NOMBRE} y ${TOKEN_LINK}`;
  }
  return variables.map((v) => v.token).join(" y ");
}

export interface OpcionesDeValidacion {
  // La familia de {nombre}: con o sin {link} (formato "solo imagen").
  conLink?: boolean;
  // O las variables de la acción, explícitas (ítem 185).
  variables?: readonly VariableDePlantilla[];
}

// El primer problema del texto, o null si Meta lo puede recibir. Uno solo y
// no la lista: el negocio corrige de a uno y el mensaje queda corto.
export function validarTextoDePlantilla(
  texto: string,
  opciones: OpcionesDeValidacion = {},
): string | null {
  const variables = opciones.variables ?? variablesDeSeguimiento(opciones.conLink ?? true);
  const permitidos = variables.map((v) => v.token);
  const recortado = texto.trim();
  if (recortado === "") {
    return "El texto de la plantilla es requerido";
  }

  if (recortado.includes("{{") || recortado.includes("}}")) {
    return `No uses llaves dobles: escribí ${descripcionDeVariables(variables)} y el sistema los traduce`;
  }
  for (const encontrado of recortado.match(/\{[^{}]*\}/g) ?? []) {
    if (permitidos.includes(encontrado)) continue;
    // El link escrito en un formato que no lo lleva: el mensaje que explica
    // por qué, y no "no es una variable válida".
    if (encontrado === TOKEN_LINK && esFamiliaDelNombre(variables)) {
      return `Con "solo imagen" el link no va en el texto: sacá ${TOKEN_LINK}`;
    }
    return `"${encontrado}" no es una variable válida: solo se pueden usar ${descripcionDeVariables(variables)}`;
  }

  for (const variable of variables) {
    const veces = contar(recortado, variable.token);
    if (variable.requerida && veces !== 1) {
      return `El texto tiene que incluir ${variable.token} exactamente una vez`;
    }
    if (!variable.requerida && veces > 1) {
      return `El texto no puede incluir ${variable.token} más de una vez`;
    }
  }

  const presentes = variables.filter((v) => recortado.includes(v.token));
  for (let i = 1; i < presentes.length; i++) {
    const anterior = presentes[i - 1].token;
    const actual = presentes[i].token;
    if (recortado.indexOf(anterior) > recortado.indexOf(actual)) {
      return `${anterior} tiene que aparecer antes que ${actual}`;
    }
  }

  for (const { token } of presentes) {
    if (recortado.startsWith(token) || recortado.endsWith(token)) {
      return `El texto no puede empezar ni terminar con ${token} (regla de Meta): agregá texto antes y después`;
    }
  }

  if (textoParaMeta(recortado).length > LARGO_MAXIMO_DEL_CUERPO) {
    return `El texto no puede superar los ${String(LARGO_MAXIMO_DEL_CUERPO)} caracteres`;
  }
  return null;
}

// Los tokens que el texto lleva, en el orden en que aparecen: es el orden de
// las variables de Meta y de los parámetros que manda el worker.
export function tokensPresentes(texto: string): string[] {
  return TODOS_LOS_TOKENS.filter((token) => texto.includes(token)).sort(
    (a, b) => texto.indexOf(a) - texto.indexOf(b),
  );
}

// El cuerpo que viaja a Meta: cada token presente -> {{n}} por orden de
// aparición ({nombre} -> {{1}}, {link} -> {{2}}). Supone un texto que ya pasó
// validarTextoDePlantilla.
export function textoParaMeta(texto: string): string {
  let resultado = texto.trim();
  tokensPresentes(resultado).forEach((token, i) => {
    resultado = resultado.replace(token, `{{${String(i + 1)}}}`);
  });
  return resultado;
}

// Los valores de ejemplo del alta en Meta, uno por variable presente, en su
// orden.
export function ejemplosDelCuerpo(
  texto: string,
  variables: readonly VariableDePlantilla[],
): string[] {
  const ejemplo = new Map(variables.map((v) => [v.token, v.ejemplo]));
  return tokensPresentes(texto).map((token) => ejemplo.get(token) ?? "");
}

// Los parámetros del cuerpo para una plantilla con la que se manda: el valor
// de cada token presente, en su orden. Se decide por el texto de LA PLANTILLA
// y no por la regla de hoy: mientras una versión nueva espera la aprobación
// de Meta, sale la anterior, con su forma.
export function parametrosDePlantilla(bodyText: string, valores: Record<string, string>): string[] {
  return tokensPresentes(bodyText).map((token) => valores[token] ?? "");
}

// La forma de siempre para la familia de {nombre}: [nombre, link], o [nombre]
// si el texto no lleva link.
export function parametrosDelCuerpo(bodyText: string, nombre: string, link: string): string[] {
  return parametrosDePlantilla(bodyText, { [TOKEN_NOMBRE]: nombre, [TOKEN_LINK]: link });
}

// Nombre de la plantilla: minúsculas, números y guion bajo (regla de Meta).
export const PATRON_NOMBRE_DE_PLANTILLA = /^[a-z0-9_]+$/;

// Código de idioma de Meta: "es", "es_AR", "en_US". El catálogo exacto lo
// valida Meta en el alta; esto solo corta lo que no puede ser un código.
export const PATRON_IDIOMA_DE_PLANTILLA = /^[a-z]{2,3}(_[A-Z]{2})?$/;
