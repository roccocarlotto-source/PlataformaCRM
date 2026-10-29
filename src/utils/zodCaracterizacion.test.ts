import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AppError } from "./AppError";
import { parseOrThrow } from "./validation";
import { CASOS_DE_MENSAJE, EMAILS_DE_PRUEBA, IDS_DE_PRUEBA } from "./zodCaracterizacion.casos";

// ---------------------------------------------------------------------------
// TABLA DE CARACTERIZACIÓN DE LA MIGRACIÓN A ZOD 4.
//
// Los esperados se GENERARON corriendo los mismos casos con zod 3.25.76, antes
// de migrar: son lo que la app mostraba. Si uno cambia, cambió un mensaje que
// ve un usuario (o qué dato se acepta). No se regraban: se arregla el código,
// o se decide el cambio a propósito y se anota acá por qué.
//
// "es" es lo que devuelve parseOrThrow (el 400 de la API). "en" es el texto
// que queda con un safeParse directo sin mapa (automatizaciones, onboarding,
// importaciones), ver src/utils/erroresDeZod.ts.
// ---------------------------------------------------------------------------

const ESPERADOS: Record<string, { es: string; en: string }> = {
  "texto ausente": { es: 'Falta "campo"', en: "Required" },
  "texto null": { es: 'Falta "campo"', en: "Expected string, received null" },
  "texto con un número": {
    es: '"campo" tiene que ser un texto',
    en: "Expected string, received number",
  },
  "número con texto": {
    es: '"campo" tiene que ser un número',
    en: "Expected number, received string",
  },
  "número NaN": { es: '"campo" tiene que ser un número', en: "Expected number, received nan" },
  "entero con decimal": {
    es: '"campo" tiene que ser un número entero',
    en: "Expected integer, received float",
  },
  "booleano con texto": {
    es: '"campo" tiene que ser verdadero o falso',
    en: "Expected boolean, received string",
  },
  "objeto con texto": {
    es: '"campo" tiene que ser un objeto',
    en: "Expected object, received string",
  },
  "lista con texto": {
    es: '"campo" tiene que ser una lista',
    en: "Expected array, received string",
  },
  "record con texto": {
    es: '"campo" tiene que ser un objeto',
    en: "Expected object, received string",
  },
  "cuerpo ausente": { es: "Falta el dato", en: "Required" },
  "cuerpo que no es objeto": {
    es: "El dato enviado tiene que ser un objeto",
    en: "Expected object, received string",
  },
  "texto vacío con min(1)": {
    es: '"campo" no puede estar vacío',
    en: "String must contain at least 1 character(s)",
  },
  "texto corto con min(3)": {
    es: '"campo" tiene que tener al menos 3 caracteres',
    en: "String must contain at least 3 character(s)",
  },
  "texto largo con max(2)": {
    es: '"campo" no puede tener más de 2 caracteres',
    en: "String must contain at most 2 character(s)",
  },
  "texto largo con max(1)": {
    es: '"campo" no puede tener más de 1 carácter',
    en: "String must contain at most 1 character(s)",
  },
  "texto con length(2)": {
    es: '"campo" no puede tener más de 2 caracteres',
    en: "String must contain exactly 2 character(s)",
  },
  "número bajo min": {
    es: '"campo" tiene que ser mayor o igual a 5',
    en: "Number must be greater than or equal to 5",
  },
  "número alto max": {
    es: '"campo" tiene que ser menor o igual a 5',
    en: "Number must be less than or equal to 5",
  },
  "positive con 0": {
    es: '"campo" tiene que ser mayor que 0',
    en: "Number must be greater than 0",
  },
  "nonnegative con -1": {
    es: '"campo" tiene que ser mayor o igual a 0',
    en: "Number must be greater than or equal to 0",
  },
  "gt con igual": { es: '"campo" tiene que ser mayor que 3', en: "Number must be greater than 3" },
  "lt con igual": { es: '"campo" tiene que ser menor que 3', en: "Number must be less than 3" },
  multipleOf: { es: '"campo" tiene que ser múltiplo de 5', en: "Number must be a multiple of 5" },
  "lista corta": {
    es: '"campo" tiene que tener al menos 2 elementos',
    en: "Array must contain at least 2 element(s)",
  },
  "lista vacía con min(1)": {
    es: '"campo" tiene que tener al menos 1 elemento',
    en: "Array must contain at least 1 element(s)",
  },
  "lista larga": {
    es: '"campo" no puede tener más de 1 elemento',
    en: "Array must contain at most 1 element(s)",
  },
  "elemento de lista inválido": {
    es: '"campo.1" tiene que ser un número',
    en: "Expected number, received string",
  },
  "enum fuera de rango": {
    es: '"campo" no es un valor válido. Las opciones son: A, B',
    en: "Invalid enum value. Expected 'A' | 'B', received 'C'",
  },
  "enum con número": {
    es: '"campo" tiene que ser de otro tipo',
    en: "Expected 'A' | 'B', received number",
  },
  "enum ausente": { es: 'Falta "campo"', en: "Required" },
  "nativeEnum fuera de rango": {
    es: '"campo" no es un valor válido. Las opciones son: WHATSAPP, WEB',
    en: "Invalid enum value. Expected 'WHATSAPP' | 'WEB', received 'SMS'",
  },
  "nativeEnum ausente": { es: 'Falta "campo"', en: "Required" },
  "literal distinto": {
    es: '"campo" no es un valor válido',
    en: 'Invalid literal value, expected "fijo"',
  },
  "literal ausente": {
    es: '"campo" no es un valor válido',
    en: 'Invalid literal value, expected "fijo"',
  },
  "claves no reconocidas": {
    es: "Hay campos que no se reconocen: b, c",
    en: "Unrecognized key(s) in object: 'b', 'c'",
  },
  "unión inválida": { es: '"campo" no es válido', en: "Invalid input" },
  "refine sin mensaje": { es: '"campo" no es válido', en: "Invalid input" },
  "refine con mensaje": { es: "Tiene que ser positivo", en: "Tiene que ser positivo" },
  "superRefine con addIssue custom": { es: "No es ok", en: "No es ok" },
  "superRefine con addIssue custom sin mensaje": {
    es: '"campo" no es válido',
    en: "Invalid input",
  },
  "email inválido": { es: '"campo" tiene que ser un email válido', en: "Invalid email" },
  "url inválida": { es: '"campo" tiene que ser una dirección web válida', en: "Invalid url" },
  "datetime inválido": {
    es: '"campo" tiene que ser una fecha y hora válidas',
    en: "Invalid datetime",
  },
  "date inválido": { es: '"campo" tiene que ser una fecha válida', en: "Invalid date" },
  "regex sin mensaje": {
    es: '"campo" tiene que ser un texto con el formato correcto',
    en: "Invalid",
  },
  "regex con mensaje": { es: "Solo dígitos", en: "Solo dígitos" },
  startsWith: {
    es: '"campo" tiene que ser un texto con el formato correcto',
    en: 'Invalid input: must start with "+"',
  },
  "coerce.date inválido": { es: '"campo" tiene que ser una fecha válida', en: "Invalid date" },
  "coerce.number con texto": {
    es: '"campo" tiene que ser un número',
    en: "Expected number, received nan",
  },
  "coerce.number entero": {
    es: '"campo" tiene que ser un número entero',
    en: "Expected integer, received float",
  },
  "min con mensaje propio": { es: "Obligatorio", en: "Obligatorio" },
  anidado: { es: '"a.b.0.c" tiene que ser un número', en: "Expected number, received string" },
  "varios errores a la vez": {
    es: 'Falta "a", "b" tiene que ser mayor o igual a 10, "c" no es un valor válido. Las opciones son: X',
    en: "Required, Number must be greater than or equal to 10, Invalid enum value. Expected 'X', received 'Y'",
  },
  "int() y min() fallan a la vez": {
    es: '"campo" tiene que ser un número entero, "campo" tiene que ser mayor o igual a 10',
    en: "Expected integer, received float, Number must be greater than or equal to 10",
  },
  "nativeEnum con número": {
    es: '"campo" no es un valor válido. Las opciones son: WHATSAPP, WEB',
    en: "Invalid enum value. Expected 'WHATSAPP' | 'WEB', received '1'",
  },
  "nativeEnum con booleano": {
    es: '"campo" tiene que ser de otro tipo',
    en: "Expected 'WHATSAPP' | 'WEB', received boolean",
  },
  "nativeEnum null": { es: 'Falta "campo"', en: "Expected 'WHATSAPP' | 'WEB', received null" },
  "literal con número": {
    es: '"campo" no es un valor válido',
    en: 'Invalid literal value, expected "fijo"',
  },
  "uuid inválido": { es: '"campo" tiene que ser un identificador válido', en: "Invalid uuid" },
  "uuid con mensaje": { es: "id inválido", en: "id inválido" },
  "email con mensaje": { es: "email inválido", en: "email inválido" },
  "required_error + invalid_type_error: ausente": {
    es: "campo es requerido",
    en: "campo es requerido",
  },
  "required_error + invalid_type_error: null": {
    es: "campo debe ser texto",
    en: "campo debe ser texto",
  },
  "required_error + invalid_type_error: de otro tipo": {
    es: "campo debe ser texto",
    en: "campo debe ser texto",
  },
  "required_error + invalid_type_error: corto (check sin mensaje)": {
    es: '"campo" tiene que tener al menos 3 caracteres',
    en: "String must contain at least 3 character(s)",
  },
  "solo required_error: de otro tipo": {
    es: '"campo" tiene que ser un texto',
    en: "Expected string, received number",
  },
  "solo invalid_type_error: ausente": { es: 'Falta "campo"', en: "Required" },
  "invalid_type_error con int()": {
    es: "campo debe ser un número entero",
    en: "campo debe ser un número entero",
  },
  "invalid_type_error con int() con mensaje": { es: "entero!", en: "entero!" },
  "invalid_type_error en coerce.date inválida": {
    es: '"campo" tiene que ser una fecha válida',
    en: "Invalid date",
  },
  "invalid_type_error en coerce.date ausente": {
    es: '"campo" tiene que ser una fecha válida',
    en: "Invalid date",
  },
  "nativeEnum con required_error + invalid_type_error: ausente": {
    es: "canal es requerido",
    en: "canal es requerido",
  },
  "nativeEnum con required_error + invalid_type_error: con número": {
    es: '"campo" no es un valor válido. Las opciones son: WHATSAPP, WEB',
    en: "Invalid enum value. Expected 'WHATSAPP' | 'WEB', received '1'",
  },
  "nativeEnum con required_error + invalid_type_error: con booleano": {
    es: "canal inválido",
    en: "canal inválido",
  },
  "nativeEnum con required_error + invalid_type_error: fuera del enum": {
    es: '"campo" no es un valor válido. Las opciones son: WHATSAPP, WEB',
    en: "Invalid enum value. Expected 'WHATSAPP' | 'WEB', received 'SMS'",
  },
  "enum con errorMap: ausente": { es: "campo debe ser A o B", en: "campo debe ser A o B" },
  "enum con errorMap: con número": { es: "campo debe ser A o B", en: "campo debe ser A o B" },
  "enum con errorMap: fuera del enum": { es: "campo debe ser A o B", en: "campo debe ser A o B" },
  "nativeEnum con errorMap: con número": {
    es: "canal debe ser WHATSAPP o WEB",
    en: "canal debe ser WHATSAPP o WEB",
  },
  "record con required_error: ausente": { es: "campo es requerido", en: "campo es requerido" },
  "record con invalid_type_error: lista": {
    es: "campo debe ser un objeto JSON",
    en: "campo debe ser un objeto JSON",
  },
  "record con clave inválida (sin mensaje)": {
    es: '"campo.abcd" no puede tener más de 3 caracteres',
    en: "String must contain at most 3 character(s)",
  },
  "record con clave inválida (con mensaje)": { es: "clave corta", en: "clave corta" },
  "record con valor inválido": {
    es: '"campo.x" no es un valor válido. Las opciones son: A',
    en: "Invalid enum value. Expected 'A', received 'B'",
  },
  "lista de enums con errorMap": { es: "solo A, solo A", en: "solo A, solo A" },
};

// Diferencias de zod 4 que se aceptaron a propósito.
const DIFERENCIAS_ACEPTADAS: Record<string, { es: string; en: string }> = {
  // En zod 4, .int() corta la validación del campo cuando falla (el check
  // trae `continue: false` fijo), así que un número que además no cumple
  // .min() muestra solo el primer mensaje. Solo pasa si el dato falla las dos
  // cosas a la vez; cada mensaje por separado sigue igual.
  "int() y min() fallan a la vez": {
    es: '"campo" tiene que ser un número entero',
    en: "Expected integer, received float",
  },
};

function mensajeEnEspanol(schema: z.ZodType, dato: unknown): string {
  try {
    parseOrThrow(schema, dato);
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    return err.message;
  }
  return "(sin error)";
}

function mensajeSinMapa(schema: z.ZodType, dato: unknown): string {
  const resultado = schema.safeParse(dato);
  return resultado.success
    ? "(sin error)"
    : resultado.error.issues.map((i) => i.message).join(", ");
}

test("cada caso de la tabla tiene su esperado de zod 3", () => {
  assert.deepEqual(CASOS_DE_MENSAJE.map((c) => c.nombre).sort(), Object.keys(ESPERADOS).sort());
});

for (const caso of CASOS_DE_MENSAJE) {
  test(`mensajes iguales a zod 3: ${caso.nombre}`, () => {
    const esperado = DIFERENCIAS_ACEPTADAS[caso.nombre] ?? ESPERADOS[caso.nombre];
    assert.ok(esperado, "falta el esperado");
    assert.equal(mensajeEnEspanol(caso.schema, caso.dato), esperado.es);
    assert.equal(mensajeSinMapa(caso.schema, caso.dato), esperado.en);
  });
}

// Un contacto que hoy se guarda no puede fallar al editarlo o reimportarlo.
// La regex de email de zod 4 se comparó con la de zod 3 sobre 14 millones de
// cadenas (todas las de hasta 7 caracteres de un alfabeto con . @ + - _ ' y
// 3 millones al azar): aceptan exactamente lo mismo. Esta tabla lo fija.
const EMAIL_ACEPTADO_EN_ZOD_3: Record<string, boolean> = {
  "persona@example.com": true,
  "Persona.Apellido@Example.COM": true,
  "persona+etiqueta@example.com": true,
  "persona@mail.empresa.com.uy": true,
  "persona@empresa.uy": true,
  "p@e.uy": true,
  "nombre_apellido-2@sub-dominio.example.org": true,
  "o'neil@example.com": true,
  "1234@example.com": true,
  "persona@example.c": false,
  "persona@-example.com": false,
  "persona@example": false,
  ".persona@example.com": false,
  "persona.@example.com": false,
  "per..sona@example.com": false,
  "persona@@example.com": false,
  "persona example@example.com": false,
  "persona@exa_mple.com": false,
  "persona@123.123.123.123": false,
  "persona@[127.0.0.1]": false,
  "pérsona@example.com": false,
  "persona@exámple.com": false,
  "persona@example.com ": false,
  "": false,
};

test("z.string().email() acepta exactamente los mismos emails que en zod 3", () => {
  for (const email of EMAILS_DE_PRUEBA) {
    assert.equal(
      z.string().email().safeParse(email).success,
      EMAIL_ACEPTADO_EN_ZOD_3[email],
      email,
    );
  }
});

// .uuid() de zod 4 exige la versión y la variante del RFC 9562 y rechazaría
// ids que hoy se aceptan (los de los seeds, por ejemplo). Los schemas usan
// .guid(), que es la regla de zod 3.
const ID_ACEPTADO_EN_ZOD_3: Record<string, boolean> = {
  "11111111-1111-4111-8111-111111111111": true,
  "11111111-1111-1111-1111-111111111111": true,
  "00000000-0000-0000-0000-000000000000": true,
  "ffffffff-ffff-ffff-ffff-ffffffffffff": true,
  "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": true,
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890": true,
  "11111111111141118111111111111111": false,
  "11111111-1111-4111-8111-11111111111": false,
  "g1111111-1111-4111-8111-111111111111": false,
  "{11111111-1111-4111-8111-111111111111}": false,
  "": false,
};

test("z.string().guid() acepta exactamente los mismos ids que .uuid() en zod 3", () => {
  for (const id of IDS_DE_PRUEBA) {
    assert.equal(z.string().guid().safeParse(id).success, ID_ACEPTADO_EN_ZOD_3[id], id);
  }
});

// Lo único que zod 4 empezó a rechazar: Infinity y los enteros fuera del
// rango seguro de JavaScript (más de 2^53). En zod 3 pasaban la validación y
// fallaban después, al guardarlos (Postgres no los acepta en las columnas
// enteras ni en Decimal).
test("zod 4 rechaza Infinity y los enteros inseguros, que zod 3 dejaba pasar", () => {
  assert.equal(z.coerce.number().safeParse("Infinity").success, false);
  assert.equal(z.number().safeParse(Infinity).success, false);
  assert.equal(
    z
      .number()
      .int()
      .safeParse(2 ** 53).success,
    false,
  );
  // Lo demás de los números, igual que antes.
  assert.equal(z.coerce.number().safeParse("").success, true);
  assert.equal(
    z
      .number()
      .int()
      .safeParse(2 ** 53 - 1).success,
    true,
  );
});
