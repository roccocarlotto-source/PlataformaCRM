// ---------------------------------------------------------------------------
// El texto de la plantilla de seguimiento post-venta (ítem 160 de
// docs/frontend-cambios-pendientes.md): validación y traducción al formato de
// Meta. Pura, sin base ni red.
//
// EL NEGOCIO NO ESCRIBE {{1}}/{{2}}. Escribe texto libre alrededor de dos
// tokens con nombre, {nombre} y {link}, y esto lo traduce. Las reglas son las
// de Meta más una propia:
//
//   - exactamente un {nombre} y un {link}: el worker manda siempre esos dos
//     parámetros, ni más ni menos (con otro número de variables Meta rechaza
//     el envío con #132000);
//   - {nombre} ANTES que {link}: Meta numera las variables por orden de
//     aparición, y el worker manda [nombre, link] en ese orden posicional. Al
//     revés, el cliente recibiría el link donde va su nombre;
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

export const TOKEN_NOMBRE = "{nombre}";
export const TOKEN_LINK = "{link}";

// Tope del cuerpo de una plantilla en Meta, medido sobre el texto que viaja.
export const LARGO_MAXIMO_DEL_CUERPO = 1024;

// Los valores de ejemplo que Meta exige en el alta de una plantilla con
// variables (los mira quien la revisa). Los mismos del ítem 159.
export const EJEMPLO_NOMBRE = "Ana";
export const EJEMPLO_LINK = "https://g.page/r/ejemplo/review";

function contar(texto: string, token: string): number {
  return texto.split(token).length - 1;
}

// El primer problema del texto, o null si Meta lo puede recibir. Uno solo y
// no la lista: el negocio corrige de a uno y el mensaje queda corto.
export function validarTextoDePlantilla(texto: string): string | null {
  const recortado = texto.trim();
  if (recortado === "") {
    return "El texto de la plantilla es requerido";
  }

  if (recortado.includes("{{") || recortado.includes("}}")) {
    return `No uses llaves dobles: escribí ${TOKEN_NOMBRE} y ${TOKEN_LINK} y el sistema los traduce`;
  }
  for (const encontrado of recortado.match(/\{[^{}]*\}/g) ?? []) {
    if (encontrado !== TOKEN_NOMBRE && encontrado !== TOKEN_LINK) {
      return `"${encontrado}" no es una variable válida: solo se pueden usar ${TOKEN_NOMBRE} y ${TOKEN_LINK}`;
    }
  }

  const nombres = contar(recortado, TOKEN_NOMBRE);
  const links = contar(recortado, TOKEN_LINK);
  if (nombres !== 1) {
    return `El texto tiene que incluir ${TOKEN_NOMBRE} exactamente una vez`;
  }
  if (links !== 1) {
    return `El texto tiene que incluir ${TOKEN_LINK} exactamente una vez`;
  }
  if (recortado.indexOf(TOKEN_NOMBRE) > recortado.indexOf(TOKEN_LINK)) {
    return `${TOKEN_NOMBRE} tiene que aparecer antes que ${TOKEN_LINK}`;
  }

  for (const token of [TOKEN_NOMBRE, TOKEN_LINK]) {
    if (recortado.startsWith(token) || recortado.endsWith(token)) {
      return `El texto no puede empezar ni terminar con ${token} (regla de Meta): agregá texto antes y después`;
    }
  }

  if (textoParaMeta(recortado).length > LARGO_MAXIMO_DEL_CUERPO) {
    return `El texto no puede superar los ${String(LARGO_MAXIMO_DEL_CUERPO)} caracteres`;
  }
  return null;
}

// El cuerpo que viaja a Meta: {nombre} -> {{1}}, {link} -> {{2}}. Supone un
// texto que ya pasó validarTextoDePlantilla.
export function textoParaMeta(texto: string): string {
  return texto.trim().replace(TOKEN_NOMBRE, "{{1}}").replace(TOKEN_LINK, "{{2}}");
}

// Nombre de la plantilla: minúsculas, números y guion bajo (regla de Meta).
export const PATRON_NOMBRE_DE_PLANTILLA = /^[a-z0-9_]+$/;

// Código de idioma de Meta: "es", "es_AR", "en_US". El catálogo exacto lo
// valida Meta en el alta; esto solo corta lo que no puede ser un código.
export const PATRON_IDIOMA_DE_PLANTILLA = /^[a-z]{2,3}(_[A-Z]{2})?$/;
