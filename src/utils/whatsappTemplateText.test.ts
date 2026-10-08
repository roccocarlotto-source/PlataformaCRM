import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EJEMPLO_LINK,
  EJEMPLO_NOMBRE,
  EJEMPLO_SALUDO,
  EJEMPLO_VEHICULO,
  LARGO_MAXIMO_DEL_CUERPO,
  PATRON_IDIOMA_DE_PLANTILLA,
  PATRON_NOMBRE_DE_PLANTILLA,
  TOKEN_SALUDO,
  TOKEN_VEHICULO,
  VARIABLES_DE_CONSULTA,
  ejemplosDelCuerpo,
  formatoLlevaImagen,
  formatoLlevaLink,
  parametrosDePlantilla,
  parametrosDelCuerpo,
  textoParaMeta,
  validarTextoDePlantilla,
  variablesDeSeguimiento,
} from "./whatsappTemplateText";

// ---------------------------------------------------------------------------
// El texto de la plantilla de seguimiento (ítem 160): lo que el negocio
// escribe con {nombre}/{link} y lo que viaja a Meta con {{1}}/{{2}}.
// ---------------------------------------------------------------------------

const VALIDO =
  "Hola {nombre}, gracias por tu compra. Dejanos tu opinión acá: {link} ¡Muchas gracias!";

test("un texto con {nombre} antes que {link}, y texto alrededor, es válido", () => {
  assert.equal(validarTextoDePlantilla(VALIDO), null);
  // Los espacios alrededor no cuentan para "empieza/termina con".
  assert.equal(validarTextoDePlantilla(`  ${VALIDO}\n`), null);
});

test("se traduce a {{1}}/{{2}} en el orden en que el worker manda [nombre, link]", () => {
  assert.equal(
    textoParaMeta(`  ${VALIDO} `),
    "Hola {{1}}, gracias por tu compra. Dejanos tu opinión acá: {{2}} ¡Muchas gracias!",
  );
});

test("vacío, o sin alguno de los dos tokens, o con uno repetido: inválido", () => {
  assert.match(validarTextoDePlantilla("   ") ?? "", /requerido/);
  assert.match(validarTextoDePlantilla("Hola, mirá esto: {link} gracias") ?? "", /\{nombre\}/);
  assert.match(validarTextoDePlantilla("Hola {nombre}, gracias") ?? "", /\{link\}/);
  assert.match(
    validarTextoDePlantilla("Hola {nombre} {nombre}, acá: {link} gracias") ?? "",
    /\{nombre\} exactamente una vez/,
  );
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, acá: {link} y {link} gracias") ?? "",
    /\{link\} exactamente una vez/,
  );
});

test("{link} antes que {nombre}: inválido (el cliente recibiría el link donde va su nombre)", () => {
  assert.match(
    validarTextoDePlantilla("Tu opinión: {link} — gracias {nombre}!") ?? "",
    /\{nombre\} tiene que aparecer antes que \{link\}/,
  );
});

test("una variable al principio o al final del texto: inválido (regla de Meta)", () => {
  assert.match(
    validarTextoDePlantilla("{nombre}, gracias. Tu opinión: {link} ¡Gracias!") ?? "",
    /no puede empezar ni terminar con \{nombre\}/,
  );
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, tu opinión acá: {link}") ?? "",
    /no puede empezar ni terminar con \{link\}/,
  );
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, tu opinión acá: {link}  \n") ?? "",
    /terminar con \{link\}/,
  );
});

test("un token mal escrito o llaves dobles: inválido, con el token en el mensaje", () => {
  assert.match(
    validarTextoDePlantilla("Hola {Nombre}, acá {nombre}: {link} gracias") ?? "",
    /"\{Nombre\}" no es una variable válida/,
  );
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, acá: {link} gracias {{3}}") ?? "",
    /llaves dobles/,
  );
});

test("más de 1024 caracteres en el cuerpo que viaja: inválido", () => {
  const relleno = "a".repeat(LARGO_MAXIMO_DEL_CUERPO);
  assert.match(
    validarTextoDePlantilla(`Hola {nombre}, ${relleno} {link} fin`) ?? "",
    /1024 caracteres/,
  );
});

test("nombre: minúsculas, números y guion bajo; idioma: código de Meta", () => {
  assert.ok(PATRON_NOMBRE_DE_PLANTILLA.test("seguimiento_postventa_2"));
  assert.ok(!PATRON_NOMBRE_DE_PLANTILLA.test("Seguimiento"));
  assert.ok(!PATRON_NOMBRE_DE_PLANTILLA.test("seguimiento-postventa"));
  assert.ok(!PATRON_NOMBRE_DE_PLANTILLA.test("seguimiento postventa"));

  assert.ok(PATRON_IDIOMA_DE_PLANTILLA.test("es"));
  assert.ok(PATRON_IDIOMA_DE_PLANTILLA.test("es_AR"));
  assert.ok(!PATRON_IDIOMA_DE_PLANTILLA.test("es-AR"));
  assert.ok(!PATRON_IDIOMA_DE_PLANTILLA.test("español"));
});

// ---------------------------------------------------------------------------
// Formato del mensaje: con "solo imagen" el texto no lleva {link}.
// ---------------------------------------------------------------------------

test("formato: solo LINK no lleva imagen; IMAGE no lleva link; LINK_AND_IMAGE, las dos", () => {
  assert.equal(formatoLlevaLink("LINK"), true);
  assert.equal(formatoLlevaImagen("LINK"), false);
  assert.equal(formatoLlevaLink("IMAGE"), false);
  assert.equal(formatoLlevaImagen("IMAGE"), true);
  assert.equal(formatoLlevaLink("LINK_AND_IMAGE"), true);
  assert.equal(formatoLlevaImagen("LINK_AND_IMAGE"), true);
});

test("sin link (solo imagen): {nombre} sí, {link} no, y las reglas de Meta siguen", () => {
  const conLink = false;
  assert.equal(
    validarTextoDePlantilla("Hola {nombre}, te dejamos el QR de tu cupón. ¡Gracias!", { conLink }),
    null,
  );
  assert.match(validarTextoDePlantilla(VALIDO, { conLink }) ?? "", /sacá \{link\}/);
  assert.match(validarTextoDePlantilla("Hola, gracias", { conLink }) ?? "", /\{nombre\}/);
  assert.match(
    validarTextoDePlantilla("Gracias por tu compra {nombre}", { conLink }) ?? "",
    /empezar ni terminar con \{nombre\}/,
  );
  assert.equal(textoParaMeta("Hola {nombre}, acá está tu QR."), "Hola {{1}}, acá está tu QR.");
});

test("parametrosDelCuerpo: [nombre, link] si el texto de la plantilla lleva {link}, si no [nombre]", () => {
  assert.deepEqual(parametrosDelCuerpo(VALIDO, "Ana", "https://x"), ["Ana", "https://x"]);
  assert.deepEqual(parametrosDelCuerpo("Hola {nombre}, tu QR.", "Ana", "https://x"), ["Ana"]);
});

// ---------------------------------------------------------------------------
// Ítem 185: variables por acción. El seguimiento de consultas usa {saludo}
// (obligatorio) y {vehiculo} (opcional); la familia de {nombre} no cambia.
// ---------------------------------------------------------------------------

test("185: {saludo} obligatorio y {vehiculo} opcional; {nombre} no vale ahí, ni {saludo} en la familia de {nombre}", () => {
  const consulta = { variables: VARIABLES_DE_CONSULTA };
  assert.equal(
    validarTextoDePlantilla(
      "¡{saludo}! Te escribimos por tu consulta sobre {vehiculo}. ¿Seguís interesado?",
      consulta,
    ),
    null,
  );
  assert.equal(
    validarTextoDePlantilla("¡{saludo}! ¿Seguís interesado en el auto?", consulta),
    null,
  );
  // Empezar con la variable sigue siendo inválido (regla de Meta): el saludo
  // va entre signos.
  assert.match(
    validarTextoDePlantilla("{saludo}, ¿seguís interesado en el auto?", consulta) ?? "",
    /no puede empezar ni terminar con \{saludo\}/,
  );
  assert.match(
    validarTextoDePlantilla("Te escribimos por {vehiculo}. ¿Seguís?", consulta) ?? "",
    /incluir \{saludo\} exactamente una vez/,
  );
  assert.match(
    validarTextoDePlantilla("¡{saludo}! Por {vehiculo} y {vehiculo}", consulta) ?? "",
    /no puede incluir \{vehiculo\} más de una vez/,
  );
  assert.match(
    validarTextoDePlantilla("Hola {nombre}, ¿seguís interesado?", consulta) ?? "",
    /"\{nombre\}" no es una variable válida: solo se pueden usar \{saludo\} y \{vehiculo\}/,
  );
  assert.match(
    validarTextoDePlantilla("Te escribimos por {vehiculo}. ¡{saludo}! ¿Seguís?", consulta) ?? "",
    /\{saludo\} tiene que aparecer antes que \{vehiculo\}/,
  );
  assert.match(
    validarTextoDePlantilla("¡{saludo}! ¿Seguís interesado en {vehiculo}", consulta) ?? "",
    /no puede empezar ni terminar con \{vehiculo\}/,
  );
  assert.match(
    validarTextoDePlantilla("¡{saludo}! Por tu consulta de {{vehiculo}}", consulta) ?? "",
    /escribí \{saludo\} y \{vehiculo\}/,
  );
  // En la familia de {nombre}, {saludo} es un token desconocido.
  assert.match(
    validarTextoDePlantilla("¡{saludo}! Dejá tu opinión en {link}. Gracias") ?? "",
    /"\{saludo\}" no es una variable válida/,
  );
});

test("185: la traducción a {{n}} y los parámetros siguen el orden de aparición de los tokens presentes", () => {
  assert.equal(
    textoParaMeta("¡{saludo}! Te escribimos por {vehiculo}. ¿Seguís?"),
    "¡{{1}}! Te escribimos por {{2}}. ¿Seguís?",
  );
  assert.equal(textoParaMeta("¡{saludo}! ¿Seguís interesado?"), "¡{{1}}! ¿Seguís interesado?");
  assert.deepEqual(
    parametrosDePlantilla("{saludo}, por {vehiculo}.", {
      [TOKEN_SALUDO]: "Hola Ana",
      [TOKEN_VEHICULO]: "Toyota Hilux 2022",
    }),
    ["Hola Ana", "Toyota Hilux 2022"],
  );
  assert.deepEqual(
    parametrosDePlantilla("{saludo}, ¿seguís?", { [TOKEN_SALUDO]: "Hola", [TOKEN_VEHICULO]: "x" }),
    ["Hola"],
  );
  assert.deepEqual(ejemplosDelCuerpo("{saludo}, por {vehiculo}.", VARIABLES_DE_CONSULTA), [
    EJEMPLO_SALUDO,
    EJEMPLO_VEHICULO,
  ]);
  assert.deepEqual(ejemplosDelCuerpo("Hola {nombre}, mirá {link}.", variablesDeSeguimiento(true)), [
    EJEMPLO_NOMBRE,
    EJEMPLO_LINK,
  ]);
});
