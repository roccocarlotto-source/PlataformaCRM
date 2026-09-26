import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LARGO_MAXIMO_DEL_CUERPO,
  PATRON_IDIOMA_DE_PLANTILLA,
  PATRON_NOMBRE_DE_PLANTILLA,
  textoParaMeta,
  validarTextoDePlantilla,
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
